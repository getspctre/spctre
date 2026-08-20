package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type gatewayIngestProvider string

const (
	providerPortkey  gatewayIngestProvider = "portkey"
	providerHelicone gatewayIngestProvider = "helicone"
	providerLiteLLM  gatewayIngestProvider = "litellm"
)

type gatewayIngestRequest struct {
	Environment string         `json:"environment"`
	Raw         map[string]any `json:"raw"`
}

// JSON tags document spctre.gateway.event.v1 for the drift test; this struct is not serialized.
type gatewayEvent struct {
	Provider         gatewayIngestProvider `json:"provider"`
	GatewayEventID   string                `json:"gatewayEventId"`
	Model            string                `json:"model"`
	AgentID          string                `json:"agentId"`
	Connector        string                `json:"connector"`
	Action           string                `json:"action"`
	ToolDeclarations []string              `json:"toolDeclarations"`
	PromptTokens     int                   `json:"promptTokens"`
	CompletionTokens int                   `json:"completionTokens"`
	LatencyMS        int                   `json:"latencyMs"`
	CostUSD          *float64              `json:"costUsd,omitempty"`
	EventTimestamp   string                `json:"eventTimestamp"`
	RawEvent         map[string]any        `json:"rawEvent"`
}

type revisionAtTime struct {
	RevisionID   string
	BranchID     string
	ArtifactHash string
	Scope        string
}

type gatewayIngestResponse struct {
	DecisionID    string  `json:"decisionId"`
	ProvenanceGap bool    `json:"provenanceGap"`
	Deduplicated  bool    `json:"deduplicated"`
	Meta          APIMeta `json:"meta"`
}

var connectorFragments = []struct {
	pattern   *regexp.Regexp
	connector string
}{
	{regexp.MustCompile(`(?i)github`), "github"},
	{regexp.MustCompile(`(?i)gitlab`), "gitlab"},
	{regexp.MustCompile(`(?i)jira`), "jira"},
	{regexp.MustCompile(`(?i)linear`), "linear"},
	{regexp.MustCompile(`(?i)slack`), "slack"},
	{regexp.MustCompile(`(?i)notion`), "notion"},
	{regexp.MustCompile(`(?i)stripe`), "stripe"},
	{regexp.MustCompile(`(?i)postgres|postgresql|pg_`), "postgresql"},
	{regexp.MustCompile(`(?i)mongo`), "mongodb"},
	{regexp.MustCompile(`(?i)redis`), "redis"},
	{regexp.MustCompile(`(?i)s3|aws_s3`), "aws-s3"},
	{regexp.MustCompile(`(?i)lambda`), "aws-lambda"},
	{regexp.MustCompile(`(?i)kubernetes|kubectl|k8s`), "kubernetes"},
	{regexp.MustCompile(`(?i)snowflake`), "snowflake"},
	{regexp.MustCompile(`(?i)bigquery`), "bigquery"},
	{regexp.MustCompile(`(?i)sendgrid`), "sendgrid"},
	{regexp.MustCompile(`(?i)hubspot`), "hubspot"},
	{regexp.MustCompile(`(?i)salesforce`), "salesforce"},
	{regexp.MustCompile(`(?i)zendesk`), "zendesk"},
	{regexp.MustCompile(`(?i)intercom`), "intercom"},
	{regexp.MustCompile(`(?i)pagerduty`), "pagerduty"},
	{regexp.MustCompile(`(?i)datadog`), "datadog"},
	{regexp.MustCompile(`(?i)sentry`), "sentry"},
}

func (s *Server) handleGatewayIngestPortkey(w http.ResponseWriter, r *http.Request) {
	s.handleGatewayIngest(w, r, providerPortkey)
}

func (s *Server) handleGatewayIngestHelicone(w http.ResponseWriter, r *http.Request) {
	s.handleGatewayIngest(w, r, providerHelicone)
}

func (s *Server) handleGatewayIngestLiteLLM(w http.ResponseWriter, r *http.Request) {
	s.handleGatewayIngest(w, r, providerLiteLLM)
}

func (s *Server) handleGatewayIngest(w http.ResponseWriter, r *http.Request, provider gatewayIngestProvider) {
	started := time.Now()
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	auth, ok := authenticateInternalGatewayRequest(w, r, traceID)
	if !ok {
		return
	}

	var payload gatewayIngestRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, bodyLimits.Runtime))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Request body must be JSON.", traceID, nil)
		return
	}
	if payload.Raw == nil {
		writeError(w, http.StatusBadRequest, "raw gateway event is required.", traceID, []validationIssue{{Path: "raw", Message: "raw gateway event is required."}})
		return
	}

	event, err := normalizeGatewayEvent(provider, payload.Raw)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), traceID, nil)
		return
	}

	environment := strings.TrimSpace(payload.Environment)
	if environment == "" {
		environment = "production"
	}

	result, err := s.ingestNormalizedGatewayEvent(r.Context(), event, auth, environment)
	if err != nil {
		s.logger.Error("gateway ingest database error", "error", err, "provider", string(provider), "gateway_event_id", event.GatewayEventID)
		writeError(w, http.StatusInternalServerError, "Ingest failed: "+err.Error(), traceID, nil)
		return
	}

	status := http.StatusCreated
	if result.Deduplicated {
		status = http.StatusOK
	}
	s.logger.Info("gateway event ingested", "provider", string(provider), "gateway_event_id", event.GatewayEventID, "decision_id", result.DecisionID, "deduplicated", result.Deduplicated, "duration_ms", time.Since(started).Milliseconds())
	result.Meta = makeMeta(traceID)
	writeJSON(w, status, result)
}

func normalizeGatewayEvent(provider gatewayIngestProvider, raw map[string]any) (gatewayEvent, error) {
	switch provider {
	case providerPortkey:
		return normalizePortkey(raw)
	case providerHelicone:
		return normalizeHelicone(raw)
	case providerLiteLLM:
		return normalizeLiteLLM(raw)
	default:
		return gatewayEvent{}, fmt.Errorf("unsupported gateway provider %q", provider)
	}
}

func normalizePortkey(raw map[string]any) (gatewayEvent, error) {
	id := stringValueFrom(raw, "id")
	if id == "" {
		return gatewayEvent{}, errors.New("Could not parse Portkey event - missing required field 'id'.")
	}
	request := objectValueFrom(raw, "request")
	response := objectValueFrom(raw, "response")
	metadata := objectValueFrom(raw, "metadata")
	usage := objectValueFrom(response, "usage")
	tools := extractGatewayToolNames(valueFrom(request, "tools"))
	connector, action, _ := mapGatewayTools(tools)
	return gatewayEvent{
		Provider: providerPortkey, GatewayEventID: id,
		Model:     stringDefault(stringValueFrom(raw, "model"), "unknown"),
		AgentID:   stringDefault(firstString(stringValueFrom(metadata, "agentId"), stringValueFrom(raw, "virtual_key")), "gateway-agent"),
		Connector: connector, Action: action, ToolDeclarations: tools,
		PromptTokens: intValueFrom(usage, "prompt_tokens"), CompletionTokens: intValueFrom(usage, "completion_tokens"),
		LatencyMS: intValueFrom(raw, "latency"), CostUSD: floatPtrFrom(raw, "cost"),
		EventTimestamp: stringDefault(firstString(stringValueFrom(raw, "timestamp"), stringValueFrom(raw, "created_at")), time.Now().UTC().Format(time.RFC3339)),
		RawEvent:       raw,
	}, nil
}

func normalizeHelicone(raw map[string]any) (gatewayEvent, error) {
	data := objectValueFrom(raw, "data")
	if data == nil {
		data = raw
	}
	id := stringValueFrom(data, "id")
	if id == "" {
		return gatewayEvent{}, errors.New("Could not parse Helicone event - missing required field 'id'.")
	}
	request := objectValueFrom(data, "request")
	response := objectValueFrom(data, "response")
	properties := objectValueFrom(data, "properties")
	cost := objectValueFrom(data, "cost")
	usage := objectValueFrom(response, "usage")
	if usage == nil {
		usage = objectValueFrom(response, "body")
	}
	tools := extractGatewayToolNames(valueFrom(request, "tools"))
	connector, action, _ := mapGatewayTools(tools)
	return gatewayEvent{
		Provider: providerHelicone, GatewayEventID: id,
		Model:     stringDefault(stringValueFrom(data, "model"), "unknown"),
		AgentID:   stringDefault(firstString(stringValueFrom(properties, "agentId"), stringValueFrom(properties, "Helicone-Session-Id")), "gateway-agent"),
		Connector: connector, Action: action, ToolDeclarations: tools,
		PromptTokens: intValueFrom(usage, "prompt_tokens"), CompletionTokens: intValueFrom(usage, "completion_tokens"),
		LatencyMS: intValueFrom(data, "latency"), CostUSD: floatPtrFrom(cost, "total"),
		EventTimestamp: stringDefault(firstString(stringValueFrom(data, "created_at"), stringValueFrom(raw, "created_at")), time.Now().UTC().Format(time.RFC3339)),
		RawEvent:       raw,
	}, nil
}

func normalizeLiteLLM(raw map[string]any) (gatewayEvent, error) {
	id := firstString(stringValueFrom(raw, "id"), stringValueFrom(raw, "call_id"))
	if id == "" {
		return gatewayEvent{}, errors.New("Could not parse LiteLLM event - missing required field 'id' or 'call_id'.")
	}
	metadata := objectValueFrom(raw, "metadata")
	usage := objectValueFrom(raw, "usage")
	tools := extractLiteLLMToolNames(valueFrom(raw, "messages"))
	connector, action, _ := mapGatewayTools(tools)
	startMs, hasStart := floatValueFrom(raw, "startTime")
	endMs, hasEnd := floatValueFrom(raw, "endTime")
	latencyMs := 0
	if hasStart && hasEnd {
		latencyMs = int((endMs - startMs) * 1000)
	}
	timestamp := stringValueFrom(raw, "created_at")
	if timestamp == "" && hasStart {
		timestamp = time.Unix(int64(startMs), 0).UTC().Format(time.RFC3339)
	}
	return gatewayEvent{
		Provider: providerLiteLLM, GatewayEventID: id,
		Model:     stringDefault(stringValueFrom(raw, "model"), "unknown"),
		AgentID:   stringDefault(firstString(stringValueFrom(metadata, "user_api_key_alias"), stringValueFrom(metadata, "user_api_key")), "gateway-agent"),
		Connector: connector, Action: action, ToolDeclarations: tools,
		PromptTokens: intValueFrom(usage, "prompt_tokens"), CompletionTokens: intValueFrom(usage, "completion_tokens"),
		LatencyMS: latencyMs, CostUSD: floatPtrFrom(metadata, "spend"),
		EventTimestamp: stringDefault(timestamp, time.Now().UTC().Format(time.RFC3339)),
		RawEvent:       raw,
	}, nil
}

func (s *Server) ingestNormalizedGatewayEvent(ctx context.Context, event gatewayEvent, auth gatewayInternalAuth, environment string) (gatewayIngestResponse, error) {
	revision, err := s.resolveRevisionAtTime(ctx, auth.TenantID, auth.WorkspaceID, event.EventTimestamp)
	if err != nil {
		return gatewayIngestResponse{}, err
	}
	_, _, connectorGap := mapGatewayTools(event.ToolDeclarations)
	provenanceGap := revision == nil || (len(event.ToolDeclarations) > 0 && connectorGap)

	policyContext := []RuntimePolicyContext{}
	artifactHash := "gateway-unresolved"
	policyRefs := []string{"gateway.provenance-gap"}
	if revision != nil {
		policyContext = []RuntimePolicyContext{{
			Scope: RuntimePolicyContextScope(revision.Scope), BranchID: revision.BranchID, RevisionID: revision.RevisionID, ArtifactHash: revision.ArtifactHash,
		}}
		artifactHash = revision.ArtifactHash
		policyRefs = []string{"gateway." + string(event.Provider) + ".ingest"}
	}

	status := "ALLOW"
	reason := "Gateway event received from " + string(event.Provider) + "; policy context resolved from published revision at event time."
	if provenanceGap {
		status = "WARN"
		reason = "Gateway event received from " + string(event.Provider) + "; policy context could not be fully resolved at event time."
	}
	decisionID := "gw-" + string(event.Provider) + "-" + event.GatewayEventID
	raw := copyMap(event.RawEvent)
	raw["_source"] = "gateway"
	raw["_gateway_provider"] = string(event.Provider)
	raw["_gateway_event_id"] = event.GatewayEventID
	raw["_provenance_gap"] = provenanceGap
	raw["_model"] = event.Model
	raw["_tool_declarations"] = event.ToolDeclarations
	raw["_prompt_tokens"] = event.PromptTokens
	raw["_completion_tokens"] = event.CompletionTokens
	raw["_cost_usd"] = event.CostUSD

	latency := event.LatencyMS
	evidence := EvidenceRequest{
		DecisionID: decisionID, TenantID: auth.TenantID, WorkspaceID: auth.WorkspaceID, Environment: environment,
		RuntimeTarget: RuntimeTarget{Stack: "CUSTOM", Adapter: func() *string { s := "gateway-" + string(event.Provider); return &s }()},
		AgentID:       event.AgentID, Connector: event.Connector, Action: event.Action, Status: status, Reason: reason,
		PolicyRefs: policyRefs, ArtifactHash: artifactHash, PolicyContext: policyContext,
		LatencyMS: &latency, CreatedAt: event.EventTimestamp, RawEvidence: raw, IngestMode: "gateway",
	}

	inserted, err := s.insertEvidence(ctx, evidence)
	if err != nil {
		return gatewayIngestResponse{}, err
	}
	if inserted {
		if err := s.appendGenericOperationsLog(ctx, auth.TenantID, auth.WorkspaceID, "EVIDENCE_INGEST", decisionID, "runtime_evidence_event", auth.ActorID, map[string]any{
			"agentId": event.AgentID, "connector": event.Connector, "action": event.Action, "status": status, "artifactHash": artifactHash,
			"runtimeStack": "CUSTOM", "gatewayProvider": string(event.Provider), "provenanceGap": provenanceGap,
		}); err != nil {
			s.logger.Warn("gateway ingest operations log append failed", "error", err, "decision_id", decisionID)
		}
	}
	return gatewayIngestResponse{DecisionID: decisionID, ProvenanceGap: provenanceGap, Deduplicated: !inserted}, nil
}

func (s *Server) resolveRevisionAtTime(ctx context.Context, tenantID string, workspaceID string, atTimestamp string) (*revisionAtTime, error) {
	var revision revisionAtTime
	err := s.db.QueryRow(ctx, `
		SELECT pr.id::text, pb.id::text, pp.artifact_hash, pb.scope
		FROM policy_publish pp
		JOIN policy_revision pr ON pr.id = pp.revision_id
		JOIN policy_branch pb ON pb.id = pp.branch_id
		WHERE pp.tenant_id = $1
			AND (pp.workspace_id = $2 OR pb.scope = 'ORGANIZATION')
			AND pp.published_at <= $3::timestamptz
		ORDER BY pp.published_at DESC
		LIMIT 1
	`, tenantID, workspaceID, atTimestamp).Scan(&revision.RevisionID, &revision.BranchID, &revision.ArtifactHash, &revision.Scope)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &revision, nil
}

func mapGatewayTools(tools []string) (string, string, bool) {
	for _, tool := range tools {
		for _, candidate := range connectorFragments {
			if candidate.pattern.MatchString(tool) {
				return candidate.connector, sanitizeGatewayAction(tool), false
			}
		}
	}
	if len(tools) > 0 {
		return "llm-gateway", sanitizeGatewayAction(tools[0]), true
	}
	return "llm-gateway", "llm_call", true
}

func extractGatewayToolNames(tools any) []string {
	values, ok := tools.([]any)
	if !ok {
		return nil
	}
	var out []string
	for _, tool := range values {
		item, ok := tool.(map[string]any)
		if !ok {
			continue
		}
		if fn, ok := item["function"].(map[string]any); ok {
			if name := stringFromAny(fn["name"]); name != "" {
				out = append(out, name)
				continue
			}
		}
		if name := stringFromAny(item["name"]); name != "" {
			out = append(out, name)
			continue
		}
		if name := stringFromAny(item["function"]); name != "" {
			out = append(out, name)
		}
	}
	return out
}

func extractLiteLLMToolNames(messages any) []string {
	values, ok := messages.([]any)
	if !ok {
		return nil
	}
	var toolCalls []any
	for _, message := range values {
		item, ok := message.(map[string]any)
		if !ok {
			continue
		}
		if calls, ok := item["tool_calls"].([]any); ok {
			toolCalls = append(toolCalls, calls...)
		}
	}
	return extractGatewayToolNames(toolCalls)
}

func sanitizeGatewayAction(value string) string {
	action := strings.ToLower(value)
	var b strings.Builder
	lastUnderscore := false
	for _, r := range action {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}

func copyMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input)+10)
	for key, value := range input {
		out[key] = value
	}
	return out
}

func valueFrom(obj map[string]any, key string) any {
	if obj == nil {
		return nil
	}
	return obj[key]
}

func objectValueFrom(obj map[string]any, key string) map[string]any {
	if obj == nil {
		return nil
	}
	value, _ := obj[key].(map[string]any)
	return value
}

func stringValueFrom(obj map[string]any, key string) string {
	if obj == nil {
		return ""
	}
	return stringFromAny(obj[key])
}

func stringFromAny(value any) string {
	if raw, ok := value.(string); ok {
		return strings.TrimSpace(raw)
	}
	return ""
}

func intValueFrom(obj map[string]any, key string) int {
	value, ok := floatValueFrom(obj, key)
	if !ok {
		return 0
	}
	return int(value)
}

func floatPtrFrom(obj map[string]any, key string) *float64 {
	value, ok := floatValueFrom(obj, key)
	if !ok {
		return nil
	}
	return &value
}

func floatValueFrom(obj map[string]any, key string) (float64, bool) {
	if obj == nil {
		return 0, false
	}
	switch value := obj[key].(type) {
	case float64:
		return value, true
	case json.Number:
		parsed, err := value.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func firstString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringDefault(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
