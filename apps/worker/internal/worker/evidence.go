package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const apiVersion = "2026-01"

var (
	validStacks         = set("AWS_BEDROCK", "GOOGLE_ADK", "AZURE_AI", "LANGCHAIN", "LANGGRAPH", "CREWAI", "AUTOGEN", "OPENAI_AGENTS", "OMNIGENT", "OPENCODE", "CLAUDE_CODE", "HERMES", "OPENCLAW", "NEMOCLAW", "CLAUDE_COWORK", "ODYSSEUS", "PAPERCLIP", "LOCAL", "CUSTOM")
	validStatuses       = set("ALLOW", "DENY", "WARN", "ESCALATE")
	validScopes         = set("ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR", "COMPANY")
	validTriggerKinds   = set("interactive", "scheduled", "mobile_dispatch", "inbound_webhook", "routine", "gateway_message")
	validEvidenceLayers = set("agent", "sandbox")
	validPluginSources  = set("public_marketplace", "corporate_marketplace", "corporate_private", "user_built")
)

type EvidenceRequest struct {
	DecisionID       string                 `json:"decisionId"`
	TenantID         string                 `json:"tenantId,omitempty"`
	WorkspaceID      string                 `json:"workspaceId,omitempty"`
	Environment      string                 `json:"environment"`
	RuntimeTarget    RuntimeTarget          `json:"runtimeTarget"`
	AgentID          string                 `json:"agentId"`
	Connector        string                 `json:"connector"`
	Action           string                 `json:"action"`
	Status           string                 `json:"status"`
	Reason           string                 `json:"reason"`
	PolicyRefs       []string               `json:"policyRefs,omitempty"`
	ArtifactHash     string                 `json:"artifactHash,omitempty"`
	PolicyContext    []RuntimePolicyContext `json:"policyContext,omitempty"`
	LatencyMS        *int                   `json:"latencyMs,omitempty"`
	CreatedAt        string                 `json:"createdAt,omitempty"`
	RawEvidence      map[string]any         `json:"rawEvidence,omitempty"`
	TrustScore       *float64               `json:"trustScore,omitempty"`
	SourceType       string                 `json:"sourceType,omitempty"`
	ExecutionTrace   any                    `json:"executionTrace,omitempty"`
	EngineVersion    string                 `json:"engineVersion,omitempty"`
	IngestMode       string                 `json:"ingestMode,omitempty"`
	ToolIntent       *string                `json:"toolIntent,omitempty"`
	PlanSummary      *string                `json:"planSummary,omitempty"`
	ToolParameters   map[string]any         `json:"toolParameters,omitempty"`
	PromptTokens     *int                   `json:"promptTokens,omitempty"`
	CompletionTokens *int                   `json:"completionTokens,omitempty"`
	TotalTokens      *int                   `json:"totalTokens,omitempty"`
	EstimatedCostUsd *float64               `json:"estimatedCostUsd,omitempty"`
	TriggerKind      string                 `json:"triggerKind,omitempty"`
	Layer            string                 `json:"layer,omitempty"`
	ExecutionContext map[string]any         `json:"executionContext,omitempty"`
	ParentAgentID    string                 `json:"parentAgentId,omitempty"`
	TraceID          string                 `json:"traceId,omitempty"`
	OrchestratorRef  map[string]any         `json:"orchestratorRef,omitempty"`
	PluginSource     string                 `json:"pluginSource,omitempty"`
	SkillContext     map[string]any         `json:"skillContext,omitempty"`
	WebhookSource    string                 `json:"webhookSource,omitempty"`
	TrustLevel       string                 `json:"trustLevel,omitempty"`
	CatalogProvider  string                 `json:"catalogProvider,omitempty"`
}

type authResult struct {
	TokenID     string
	TenantID    string
	WorkspaceID string
	PrincipalID string
	Scopes      []string
}

type evidenceResponse struct {
	Evidence     EvidenceRequest `json:"evidence"`
	Deduplicated bool            `json:"deduplicated,omitempty"`
	Meta         APIMeta         `json:"meta"`
}

func (s *Server) handleEvidence(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	var payload EvidenceRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, bodyLimits.Runtime))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Request body must be JSON.", traceID, nil)
		return
	}

	if issues := payload.validate(); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, issues[0].Message, traceID, issues)
		return
	}

	payload.Sanitize()

	auth, err := s.authenticateRuntimeRequest(r.Context(), r, payload)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error(), traceID, nil)
		return
	}

	if err := s.validateWorkspaceBoundary(r.Context(), auth.TenantID, auth.WorkspaceID); err != nil {
		writeError(w, http.StatusForbidden, err.Error(), traceID, nil)
		return
	}
	if err := s.validatePolicyContextBoundary(r.Context(), payload.PolicyContext, auth.TenantID, auth.WorkspaceID); err != nil {
		writeError(w, http.StatusForbidden, err.Error(), traceID, nil)
		return
	}

	payload.TenantID = auth.TenantID
	payload.WorkspaceID = auth.WorkspaceID
	if payload.CreatedAt == "" {
		payload.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if payload.LatencyMS == nil {
		zero := 0
		payload.LatencyMS = &zero
	}

	source := resolveIngestionSource(r, payload)
	payload.enrichRawEvidence(source)

	inserted, err := s.insertEvidence(r.Context(), payload)
	if err != nil {
		s.logger.Error("evidence ingest database error", "error", err)
		writeError(w, http.StatusInternalServerError, "Service temporarily unavailable.", traceID, nil)
		return
	}
	if !inserted {
		s.emitDedupTelemetry(payload.DecisionID, auth.TenantID, source)
		writeJSON(w, http.StatusOK, evidenceResponse{Evidence: payload, Deduplicated: true, Meta: makeMeta(traceID)})
		return
	}

	s.spawn(func(ctx context.Context) { s.appendOperationsLog(ctx, payload, auth.PrincipalID) })
	if payload.TrustScore != nil {
		s.spawn(func(ctx context.Context) { s.ingestTrustScore(ctx, payload) })
	}

	lag := time.Since(parseCreatedAt(payload.CreatedAt))
	if lag > time.Minute {
		s.logger.Warn("evidence ingest lag above threshold", "decision_id", payload.DecisionID, "lag_ms", lag.Milliseconds(), "source", source)
	}
	s.logger.Info("evidence ingested", "decision_id", payload.DecisionID, "source", source, "status", payload.Status, "duration_ms", time.Since(started).Milliseconds())
	writeJSON(w, http.StatusCreated, evidenceResponse{Evidence: payload, Meta: makeMeta(traceID)})
}

// enrichRawEvidence folds the optional, denormalized fields of the request into
// the RawEvidence map that is persisted alongside the decision. Only fields that
// are set are written, preserving the previous behavior exactly.
func (p *EvidenceRequest) enrichRawEvidence(source string) {
	if p.RawEvidence == nil {
		p.RawEvidence = map[string]any{}
	}
	p.RawEvidence["_source"] = source
	p.RawEvidence["runtimeTarget"] = p.RuntimeTarget
	p.enrichRawEvidenceUsage()
	p.enrichRawEvidenceContext()
}

// enrichRawEvidenceUsage records the request's I/O payload and model-usage
// fields when present.
func (p *EvidenceRequest) enrichRawEvidenceUsage() {
	if p.ToolIntent != nil {
		p.RawEvidence["toolIntent"] = *p.ToolIntent
	}
	if p.PlanSummary != nil {
		p.RawEvidence["planSummary"] = *p.PlanSummary
	}
	if p.ToolParameters != nil {
		p.RawEvidence["toolParameters"] = p.ToolParameters
	}
	if p.PromptTokens != nil {
		p.RawEvidence["promptTokens"] = *p.PromptTokens
	}
	if p.CompletionTokens != nil {
		p.RawEvidence["completionTokens"] = *p.CompletionTokens
	}
	if p.TotalTokens != nil {
		p.RawEvidence["totalTokens"] = *p.TotalTokens
	} else if p.PromptTokens != nil && p.CompletionTokens != nil {
		total := *p.PromptTokens + *p.CompletionTokens
		p.RawEvidence["totalTokens"] = total
	}
	if p.EstimatedCostUsd != nil {
		p.RawEvidence["estimatedCostUsd"] = *p.EstimatedCostUsd
	}
}

// enrichRawEvidenceContext records the routing, provenance, and trust context
// fields when present.
func (p *EvidenceRequest) enrichRawEvidenceContext() {
	if p.TriggerKind != "" {
		p.RawEvidence["triggerKind"] = p.TriggerKind
	}
	if p.Layer != "" {
		p.RawEvidence["layer"] = p.Layer
	}
	if p.ExecutionContext != nil {
		p.RawEvidence["executionContext"] = p.ExecutionContext
	}
	if p.ParentAgentID != "" {
		p.RawEvidence["parentAgentId"] = p.ParentAgentID
	}
	if p.TraceID != "" {
		p.RawEvidence["traceId"] = p.TraceID
	}
	if p.OrchestratorRef != nil {
		p.RawEvidence["orchestratorRef"] = p.OrchestratorRef
	}
	if p.PluginSource != "" {
		p.RawEvidence["pluginSource"] = p.PluginSource
	}
	if p.SkillContext != nil {
		p.RawEvidence["skillContext"] = p.SkillContext
	}
	if p.WebhookSource != "" {
		p.RawEvidence["webhookSource"] = p.WebhookSource
	}
	if p.TrustLevel != "" {
		p.RawEvidence["trustLevel"] = p.TrustLevel
	}
	if p.CatalogProvider != "" {
		p.RawEvidence["catalogProvider"] = p.CatalogProvider
	}
}

type validationIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// validate runs the field validators in a fixed order and concatenates their
// issues. Each validator owns one concern to keep this path readable and its
// cyclomatic complexity bounded.
func (p EvidenceRequest) validate() []validationIssue {
	var issues []validationIssue
	issues = append(issues, p.validateRequiredFields()...)
	issues = append(issues, p.validateFieldFormats()...)
	issues = append(issues, p.validateNonGatewayRequirements()...)
	issues = append(issues, p.validatePolicyContextNodes()...)
	issues = append(issues, p.validateNumericBounds()...)
	return issues
}

func (p EvidenceRequest) validateRequiredFields() []validationIssue {
	var issues []validationIssue
	required := map[string]string{
		"decisionId":          p.DecisionID,
		"environment":         p.Environment,
		"runtimeTarget.stack": string(p.RuntimeTarget.Stack),
		"agentId":             p.AgentID,
		"connector":           p.Connector,
		"action":              p.Action,
		"status":              p.Status,
		"reason":              p.Reason,
	}
	for path, value := range required {
		if strings.TrimSpace(value) == "" {
			issues = append(issues, validationIssue{Path: path, Message: path + " is required."})
		}
	}
	return issues
}

func (p EvidenceRequest) validateFieldFormats() []validationIssue {
	var issues []validationIssue
	if p.RuntimeTarget.Stack != "" && !validStacks[string(p.RuntimeTarget.Stack)] {
		issues = append(issues, validationIssue{Path: "runtimeTarget.stack", Message: "runtimeTarget.stack is not supported."})
	}
	if p.Status != "" && !validStatuses[p.Status] {
		issues = append(issues, validationIssue{Path: "status", Message: "status must be ALLOW, DENY, WARN, or ESCALATE."})
	}
	if p.CreatedAt != "" {
		if _, err := time.Parse(time.RFC3339, p.CreatedAt); err != nil {
			issues = append(issues, validationIssue{Path: "createdAt", Message: "createdAt must be an ISO timestamp."})
		}
	}
	if p.LatencyMS != nil && *p.LatencyMS < 0 {
		issues = append(issues, validationIssue{Path: "latencyMs", Message: "latencyMs must be non-negative."})
	}
	if p.IngestMode != "" && p.IngestMode != "standard" && p.IngestMode != "gateway" {
		issues = append(issues, validationIssue{Path: "ingestMode", Message: "ingestMode must be standard or gateway."})
	}
	if p.TriggerKind != "" && !validTriggerKinds[p.TriggerKind] {
		issues = append(issues, validationIssue{Path: "triggerKind", Message: "triggerKind is not supported."})
	}
	if p.Layer != "" && !validEvidenceLayers[p.Layer] {
		issues = append(issues, validationIssue{Path: "layer", Message: "layer is not supported."})
	}
	if p.PluginSource != "" && !validPluginSources[p.PluginSource] {
		issues = append(issues, validationIssue{Path: "pluginSource", Message: "pluginSource is not supported."})
	}
	return issues
}

func (p EvidenceRequest) validateNonGatewayRequirements() []validationIssue {
	if p.IngestMode == "gateway" {
		return nil
	}
	var issues []validationIssue
	if len(p.PolicyRefs) == 0 {
		issues = append(issues, validationIssue{Path: "policyRefs", Message: "policyRefs must include at least one policy reference."})
	}
	if strings.TrimSpace(p.ArtifactHash) == "" {
		issues = append(issues, validationIssue{Path: "artifactHash", Message: "artifactHash is required."})
	}
	if len(p.PolicyContext) == 0 {
		issues = append(issues, validationIssue{Path: "policyContext", Message: "policyContext must include at least one valid context node."})
	}
	return issues
}

func (p EvidenceRequest) validatePolicyContextNodes() []validationIssue {
	var issues []validationIssue
	for i, ctx := range p.PolicyContext {
		prefix := fmt.Sprintf("policyContext.%d", i)
		if !validScopes[string(ctx.Scope)] {
			issues = append(issues, validationIssue{Path: prefix + ".scope", Message: "policy context scope is not supported."})
		}
		if ctx.BranchID == "" {
			issues = append(issues, validationIssue{Path: prefix + ".branchId", Message: "branchId is required."})
		}
		if ctx.RevisionID == "" {
			issues = append(issues, validationIssue{Path: prefix + ".revisionId", Message: "revisionId is required."})
		}
		if ctx.ArtifactHash == "" {
			issues = append(issues, validationIssue{Path: prefix + ".artifactHash", Message: "artifactHash is required."})
		}
	}
	return issues
}

func (p EvidenceRequest) validateNumericBounds() []validationIssue {
	var issues []validationIssue
	if p.ToolIntent != nil && len(*p.ToolIntent) > 100000 {
		issues = append(issues, validationIssue{Path: "toolIntent", Message: "toolIntent must be at most 100000 characters."})
	}
	if p.PlanSummary != nil && len(*p.PlanSummary) > 100000 {
		issues = append(issues, validationIssue{Path: "planSummary", Message: "planSummary must be at most 100000 characters."})
	}
	if p.PromptTokens != nil && *p.PromptTokens < 0 {
		issues = append(issues, validationIssue{Path: "promptTokens", Message: "promptTokens must be non-negative."})
	}
	if p.CompletionTokens != nil && *p.CompletionTokens < 0 {
		issues = append(issues, validationIssue{Path: "completionTokens", Message: "completionTokens must be non-negative."})
	}
	if p.TotalTokens != nil && *p.TotalTokens < 0 {
		issues = append(issues, validationIssue{Path: "totalTokens", Message: "totalTokens must be non-negative."})
	}
	if p.EstimatedCostUsd != nil && *p.EstimatedCostUsd < 0 {
		issues = append(issues, validationIssue{Path: "estimatedCostUsd", Message: "estimatedCostUsd must be non-negative."})
	}
	return issues
}

func (s *Server) authenticateRuntimeRequest(ctx context.Context, r *http.Request, input EvidenceRequest) (authResult, error) {
	bearer := bearerToken(r)
	if bearer == "" {
		return authResult{}, errors.New("Missing bearer token. Issue one with: spctre init")
	}
	requestedTenantID := firstNonEmpty(r.Header.Get("x-spctre-tenant-id"), input.TenantID)
	requestedWorkspaceID := firstNonEmpty(r.Header.Get("x-spctre-workspace-id"), input.WorkspaceID)
	tokenHash := hashToken(bearer)

	var auth authResult
	var scopes []string
	err := s.db.QueryRow(ctx, `
		SELECT id, tenant_id::text, workspace_id::text, principal_id, scopes
		FROM service_token
		WHERE token_hash = $1
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > now())
		LIMIT 1
	`, tokenHash).Scan(&auth.TokenID, &auth.TenantID, &auth.WorkspaceID, &auth.PrincipalID, &scopes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return authResult{}, errors.New("Missing or invalid bearer token.")
		}
		return authResult{}, err
	}
	auth.Scopes = scopes
	if !contains(scopes, "evidence:write") {
		return authResult{}, errors.New("Token is missing evidence:write scope.")
	}
	if input.Action == "heartbeat" && !contains(scopes, "heartbeat:write") {
		return authResult{}, errors.New("Token is missing heartbeat:write scope.")
	}
	if requestedTenantID != "" && requestedTenantID != auth.TenantID {
		return authResult{}, errors.New("Tenant is outside this token scope.")
	}
	if requestedWorkspaceID != "" && requestedWorkspaceID != auth.WorkspaceID {
		return authResult{}, errors.New("Workspace is outside this token scope.")
	}
	if _, err := s.db.Exec(ctx, `UPDATE service_token SET last_used_at = now() WHERE id = $1`, auth.TokenID); err != nil {
		s.logger.Warn("service token last-used update failed", "error", err, "token_id", auth.TokenID)
	}
	return auth, nil
}

func (s *Server) validateWorkspaceBoundary(ctx context.Context, tenantID string, workspaceID string) error {
	var id string
	err := s.db.QueryRow(ctx, `
		SELECT id::text
		FROM workspace
		WHERE tenant_id = $1 AND id = $2
		LIMIT 1
	`, tenantID, workspaceID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("Workspace is not available in the selected tenant.")
	}
	return err
}

func (s *Server) validatePolicyContextBoundary(ctx context.Context, policyContext []RuntimePolicyContext, tenantID string, workspaceID string) error {
	for _, pc := range policyContext {
		var id string
		err := s.db.QueryRow(ctx, `
			SELECT pr.id::text
			FROM policy_revision pr
			JOIN policy_branch pb ON pb.id = pr.branch_id AND pb.tenant_id = pr.tenant_id
			WHERE pr.tenant_id = $1
			  AND pr.id = $2
			  AND pr.branch_id = $3
			  AND (pb.workspace_id = $4 OR pb.scope = 'ORGANIZATION')
			LIMIT 1
		`, tenantID, pc.RevisionID, pc.BranchID, workspaceID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("Policy context contains a branch or revision outside this tenant/workspace.")
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) insertEvidence(ctx context.Context, evidence EvidenceRequest) (bool, error) {
	rawEvidence, err := json.Marshal(evidence.RawEvidence)
	if err != nil {
		return false, err
	}
	policyContext, err := json.Marshal(evidence.PolicyContext)
	if err != nil {
		return false, err
	}
	executionTrace, err := nullableJSON(evidence.ExecutionTrace)
	if err != nil {
		return false, err
	}

	tx, err := s.beginTenantTx(ctx, evidence.TenantID)
	if err != nil {
		return false, err
	}
	defer s.rollbackAfterFailure(ctx, tx, "persist_evidence")

	var keyDecisionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO runtime_evidence_event_key (tenant_id, decision_id)
		VALUES ($1, $2)
		ON CONFLICT (tenant_id, decision_id) DO NOTHING
		RETURNING decision_id
	`, evidence.TenantID, evidence.DecisionID).Scan(&keyDecisionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Serialize per-tenant appends through the chain-head row: the upsert takes a
	// row lock (shared with the web repository's evidence writers, replacing the
	// old pg_advisory_xact_lock) and last_hash is the O(1) prev-hash read instead
	// of a partition-wide tail scan. See database-optimizations-audit finding 2.
	var prevHash *string
	err = tx.QueryRow(ctx, `
		INSERT INTO runtime_evidence_chain_head (tenant_id, last_hash)
		VALUES ($1, NULL)
		ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
		RETURNING last_hash
	`, evidence.TenantID).Scan(&prevHash)
	if err != nil {
		return false, err
	}

	contentHash := evidenceContentHash(evidence.TenantID, evidence.WorkspaceID, evidence.DecisionID, evidence.ArtifactHash, evidence.Status, policyContext, rawEvidence, evidence.CreatedAt, prevHash)

	var eventID string
	var eventCreatedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO runtime_evidence_event (
			decision_id, tenant_id, workspace_id, environment,
			runtime_stack, runtime_adapter, agent_id, connector, action,
			status, reason, policy_refs, artifact_hash, policy_context,
			raw_evidence, latency_ms, created_at, execution_trace, engine_version,
			evidence_content_hash, evidence_prev_hash
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8, $9,
			$10, $11, $12, $13, $14::jsonb,
			$15::jsonb, $16, $17, $18::jsonb, nullif($19, ''),
			$20, $21
		)
		RETURNING id, created_at
	`, evidence.DecisionID, evidence.TenantID, evidence.WorkspaceID, evidence.Environment,
		string(evidence.RuntimeTarget.Stack), evidence.RuntimeTarget.Adapter, evidence.AgentID, evidence.Connector, evidence.Action,
		evidence.Status, evidence.Reason, evidence.PolicyRefs, evidence.ArtifactHash, string(policyContext),
		string(rawEvidence), *evidence.LatencyMS, evidence.CreatedAt, executionTrace, evidence.EngineVersion,
		contentHash, prevHash).Scan(&eventID, &eventCreatedAt)
	if err != nil {
		return false, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE runtime_evidence_event_key
		SET evidence_event_id = $3,
		    evidence_created_at = $4
		WHERE tenant_id = $1
		  AND decision_id = $2
	`, evidence.TenantID, evidence.DecisionID, eventID, eventCreatedAt); err != nil {
		return false, err
	}

	// Advance the chain head to this event's hash so the next append links to it.
	if _, err := tx.Exec(ctx, `
		UPDATE runtime_evidence_chain_head
		SET last_hash = $2, updated_at = now()
		WHERE tenant_id = $1
	`, evidence.TenantID, contentHash); err != nil {
		return false, err
	}

	// Count the event against the tenant's billing period, in this transaction.
	// The dedupe key insert above already rejected replays, so reaching here
	// means a genuinely new governed event and the count is exactly-once.
	//
	// The period boundary is derived in SQL rather than in Go so this stays one
	// statement with no clock disagreement between the worker and the web app,
	// which increments the same rows. date_trunc('month', now() AT TIME ZONE
	// 'UTC') matches resolveBillingPeriod in
	// apps/web/lib/entitlements/billing-period.ts.
	if _, err := tx.Exec(ctx, `
		INSERT INTO tenant_usage_period (
			tenant_id, period_start, period_end, metric, ingested_count
		) VALUES (
			$1,
			date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
			(date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC',
			'RETAINED_EVENTS',
			1
		)
		ON CONFLICT (tenant_id, metric, period_start) DO UPDATE SET
			ingested_count = tenant_usage_period.ingested_count + 1,
			-- Maintain the standing retained gauge too, but only once the audit
			-- has seeded it. A NULL means no baseline exists yet, and starting
			-- from 1 would claim the tenant holds a single retained event when
			-- it may hold millions from earlier months.
			retained_count = CASE
				WHEN tenant_usage_period.retained_count IS NULL THEN NULL
				ELSE tenant_usage_period.retained_count + 1
			END,
			updated_at = now()
	`, evidence.TenantID); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Server) appendOperationsLog(ctx context.Context, evidence EvidenceRequest, principalID string) {
	payload := map[string]any{
		"agentId":      evidence.AgentID,
		"connector":    evidence.Connector,
		"action":       evidence.Action,
		"status":       evidence.Status,
		"artifactHash": evidence.ArtifactHash,
		"runtimeStack": string(evidence.RuntimeTarget.Stack),
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		s.logger.Warn("operations log payload marshal failed", "error", err)
		return
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		s.logger.Warn("operations log transaction failed", "error", err)
		return
	}
	defer s.rollbackAfterFailure(ctx, tx, "append_evidence_operations_log")

	prevHash, err := operationsChainPrevHash(ctx, tx, evidence.TenantID)
	if err != nil {
		s.logger.Warn("operations log chain head lookup failed", "error", err)
		return
	}

	contentHash := operationsContentHash("EVIDENCE_INGEST", evidence.DecisionID, "runtime_evidence_event", principalID, payloadBytes, prevHash)
	if _, err = tx.Exec(ctx, `
		INSERT INTO agt_operations_log (
			tenant_id, workspace_id, event_type, source_id, source_table,
			actor_id, payload, content_hash, prev_hash
		) VALUES ($1, $2, 'EVIDENCE_INGEST', $3, 'runtime_evidence_event', $4, $5::jsonb, $6, $7)
	`, evidence.TenantID, evidence.WorkspaceID, evidence.DecisionID, principalID, string(payloadBytes), contentHash, prevHash); err != nil {
		s.logger.Warn("operations log append failed", "error", err)
		return
	}
	if err = advanceOperationsChainHead(ctx, tx, evidence.TenantID, contentHash); err != nil {
		s.logger.Warn("operations log chain head advance failed", "error", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.logger.Warn("operations log commit failed", "error", err, "decision_id", evidence.DecisionID)
	}
}

func (s *Server) ingestTrustScore(ctx context.Context, evidence EvidenceRequest) {
	var previous *float64
	err := s.db.QueryRow(ctx, `
		SELECT trust_score::float8
		FROM agt_trust_score_event
		WHERE tenant_id = $1 AND workspace_id = $2 AND agent_id = $3
		ORDER BY created_at DESC
		LIMIT 1
	`, evidence.TenantID, evidence.WorkspaceID, evidence.AgentID).Scan(&previous)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.logger.Warn("trust score previous lookup failed", "error", err)
		return
	}
	var delta *float64
	if previous != nil && evidence.TrustScore != nil {
		value := *evidence.TrustScore - *previous
		delta = &value
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO agt_trust_score_event (
			tenant_id, workspace_id, agent_id, environment, runtime_stack,
			trust_score, previous_score, delta, source, source_ref
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EVIDENCE_INGEST', $9)
	`, evidence.TenantID, evidence.WorkspaceID, evidence.AgentID, evidence.Environment, string(evidence.RuntimeTarget.Stack),
		evidence.TrustScore, previous, delta, evidence.DecisionID)
	if err != nil {
		s.logger.Warn("trust score ingest failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string, traceID string, issues []validationIssue) {
	payload := map[string]any{"error": message, "meta": makeMeta(traceID)}
	if len(issues) > 0 {
		payload["issues"] = issues
	}
	writeJSON(w, status, payload)
}

func makeMeta(traceID string) APIMeta {
	return APIMeta{TraceID: traceID, Version: apiVersion, TS: time.Now().UTC()}
}

func traceID(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("x-request-id")); value != "" {
		return value
	}
	if value := strings.TrimSpace(r.Header.Get("traceparent")); value != "" {
		return value
	}
	return fmt.Sprintf("go-%d", time.Now().UnixNano())
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func resolveIngestionSource(r *http.Request, payload EvidenceRequest) string {
	header := strings.ToLower(strings.TrimSpace(r.Header.Get("x-spctre-source")))
	if header == "mcp" || header == "hook" || header == "gateway" {
		return header
	}
	body := strings.ToLower(strings.TrimSpace(payload.SourceType))
	if body == "mcp" || body == "gateway" {
		return body
	}
	if payload.IngestMode == "gateway" {
		return "gateway"
	}
	return "hook"
}

func (s *Server) emitDedupTelemetry(decisionID string, tenantID string, source string) {
	s.logger.Warn("evidence deduplicated", "event", "evidence.dedup_suppressed", "decision_id", decisionID, "tenant_id", tenantID, "incoming_source", source)
}

func nullableJSON(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

func operationsContentHash(eventType, sourceID, sourceTable, actorID string, payload []byte, prevHash *string) string {
	payloadHashRaw := sha256.Sum256(payload)
	payloadHash := hex.EncodeToString(payloadHashRaw[:])
	prev := any(nil)
	if prevHash != nil {
		prev = *prevHash
	}
	source, _ := json.Marshal(map[string]any{
		"eventType":   eventType,
		"sourceId":    sourceID,
		"sourceTable": sourceTable,
		"actorId":     actorID,
		"payloadHash": payloadHash,
		"prevHash":    prev,
	})
	sum := sha256.Sum256(source)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func evidenceContentHash(tenantID, workspaceID, decisionID, artifactHash, status string, policyContext, rawEvidence []byte, createdAt string, prevHash *string) string {
	prev := any(nil)
	if prevHash != nil {
		prev = *prevHash
	}
	source, _ := json.Marshal(map[string]any{
		"artifactHash":  artifactHash,
		"createdAt":     createdAt,
		"decisionId":    decisionID,
		"policyContext": json.RawMessage(policyContext),
		"prevHash":      prev,
		"rawEvidence":   json.RawMessage(rawEvidence),
		"status":        status,
		"tenantId":      tenantID,
		"workspaceId":   workspaceID,
	})
	sum := sha256.Sum256(source)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func parseCreatedAt(value string) time.Time {
	createdAt, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Now()
	}
	return createdAt
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func set(values ...string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[value] = true
	}
	return out
}
