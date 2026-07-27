package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var validTrustSources = set("EVIDENCE_INGEST", "POLICY_EVALUATION", "MANUAL", "IDENTITY_EVENT", "SYSTEM")
var validRuntimeStacks = set("AWS_BEDROCK", "GOOGLE_ADK", "AZURE_AI", "LANGCHAIN", "LANGGRAPH", "CREWAI", "AUTOGEN", "OPENAI_AGENTS", "OMNIGENT", "OPENCODE", "CLAUDE_CODE", "HERMES", "OPENCLAW", "NEMOCLAW", "CLAUDE_COWORK", "ODYSSEUS", "PAPERCLIP", "LOCAL", "CUSTOM")
var validContextBudgetEventTypes = set("TOKEN_GROWTH", "SUMMARIZATION_EVENT", "CONTEXT_SOURCE_MIX", "BUDGET_BREACH")
var validTrustActions = set("ALLOW", "WARN", "ESCALATE", "REVIEW")
var validConsequenceTiers = set("LOW", "MEDIUM", "HIGH", "CRITICAL")

type trustIngestRequest struct {
	AgentID      string   `json:"agentId"`
	Environment  string   `json:"environment"`
	RuntimeStack string   `json:"runtimeStack"`
	TrustScore   *float64 `json:"trustScore"`
	Source       string   `json:"source"`
	SourceRef    string   `json:"sourceRef,omitempty"`
	Reason       string   `json:"reason,omitempty"`
}

type trustEvaluateRequest struct {
	TrustScore      *float64 `json:"trustScore,omitempty"`
	ContextTokens   *int     `json:"contextTokens,omitempty"`
	BudgetLimit     *int     `json:"budgetLimit,omitempty"`
	AgentClass      string   `json:"agentClass,omitempty"`
	Environment     string   `json:"environment,omitempty"`
	Connector       string   `json:"connector,omitempty"`
	ConsequenceTier string   `json:"consequenceTier,omitempty"`
	SessionID       string   `json:"sessionId,omitempty"`
	AgentID         string   `json:"agentId,omitempty"`
	RuntimeStack    string   `json:"runtimeStack,omitempty"`
}

type trustEvaluateResult struct {
	Action               string   `json:"action"`
	Reason               string   `json:"reason"`
	MatchedPolicyID      *string  `json:"matchedPolicyId,omitempty"`
	MatchedPolicyName    *string  `json:"matchedPolicyName,omitempty"`
	TrustScore           *float64 `json:"trustScore,omitempty"`
	ContextTokens        *int     `json:"contextTokens,omitempty"`
	BudgetUtilization    *float64 `json:"budgetUtilization,omitempty"`
	RecommendedRiskLevel string   `json:"recommendedRiskLevel"`
	EvaluatedAt          string   `json:"evaluatedAt"`
}

type contextBudgetRequest struct {
	SessionID         string         `json:"sessionId"`
	AgentID           string         `json:"agentId"`
	Environment       string         `json:"environment"`
	RuntimeStack      string         `json:"runtimeStack"`
	EventType         string         `json:"eventType"`
	TokenCount        *int           `json:"tokenCount"`
	TokenDelta        *int           `json:"tokenDelta,omitempty"`
	ContextSourceMix  map[string]any `json:"contextSourceMix,omitempty"`
	BudgetLimit       *int           `json:"budgetLimit,omitempty"`
	BudgetUtilization *float64       `json:"budgetUtilization,omitempty"`
	GovernanceAction  string         `json:"governanceAction,omitempty"`
	PolicyRef         string         `json:"policyRef,omitempty"`
}

type trustPolicy struct {
	ID                       string
	Name                     string
	Enabled                  bool
	AgentClass               *string
	Environment              *string
	Connector                *string
	ConsequenceTier          *string
	WarnThreshold            *float64
	EscalateThreshold        *float64
	ReviewThreshold          *float64
	ContextWarnThreshold     *int
	ContextEscalateThreshold *int
}

func (s *Server) handleTrustIngest(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}
	auth, ok := authenticateInternalGatewayRequest(w, r, traceID)
	if !ok {
		return
	}
	var payload trustIngestRequest
	if err := decodeJSONRequest(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), traceID, nil)
		return
	}
	if issues := payload.validate(); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, issues[0].Message, traceID, issues)
		return
	}
	if err := s.ingestTrustScoreWithOps(r.Context(), auth, payload); err != nil {
		s.logger.Error("trust score ingest failed", "error", err, "agent_id", payload.AgentID)
		writeError(w, http.StatusInternalServerError, "Trust score could not be ingested.", traceID, nil)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "agentId": payload.AgentID, "trustScore": payload.TrustScore, "meta": makeMeta(traceID)})
}

func (s *Server) handleTrustEvaluate(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}
	auth, ok := authenticateInternalGatewayRequest(w, r, traceID)
	if !ok {
		return
	}
	var payload trustEvaluateRequest
	if err := decodeJSONRequest(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), traceID, nil)
		return
	}
	if issues := payload.validate(); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, issues[0].Message, traceID, issues)
		return
	}
	result, err := s.evaluateTrustGovernanceForRequest(r.Context(), auth, payload)
	if err != nil {
		s.logger.Error("trust governance evaluate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Trust governance evaluation failed.", traceID, nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"result": result,
		"gatewayHint": map[string]any{
			"trustScore":    payload.TrustScore,
			"contextBudget": payload.ContextTokens,
			"riskLevel":     result.RecommendedRiskLevel,
		},
		"meta": makeMeta(traceID),
	})
}

func (s *Server) handleTrustContextBudget(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}
	auth, ok := authenticateInternalGatewayRequest(w, r, traceID)
	if !ok {
		return
	}
	var payload contextBudgetRequest
	if err := decodeJSONRequest(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), traceID, nil)
		return
	}
	if issues := payload.validate(); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, issues[0].Message, traceID, issues)
		return
	}
	id, err := s.ingestContextBudgetWithOps(r.Context(), auth, payload)
	if err != nil {
		s.logger.Error("context budget ingest failed", "error", err, "session_id", payload.SessionID)
		writeError(w, http.StatusInternalServerError, "Context budget event could not be ingested.", traceID, nil)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": id, "meta": makeMeta(traceID)})
}

func (p trustIngestRequest) validate() []validationIssue {
	var issues []validationIssue
	if strings.TrimSpace(p.AgentID) == "" {
		issues = append(issues, validationIssue{Path: "agentId", Message: "agentId is required."})
	}
	if strings.TrimSpace(p.Environment) == "" {
		issues = append(issues, validationIssue{Path: "environment", Message: "environment is required."})
	}
	if !validRuntimeStacks[p.RuntimeStack] {
		issues = append(issues, validationIssue{Path: "runtimeStack", Message: "runtimeStack must be a supported runtime stack."})
	}
	if p.TrustScore == nil || *p.TrustScore < 0 || *p.TrustScore > 1 {
		issues = append(issues, validationIssue{Path: "trustScore", Message: "trustScore must be a number between 0 and 1."})
	}
	if !validTrustSources[p.Source] {
		issues = append(issues, validationIssue{Path: "source", Message: "source must be a valid TrustScoreSource."})
	}
	return issues
}

func (p trustEvaluateRequest) validate() []validationIssue {
	var issues []validationIssue
	if p.TrustScore != nil && (*p.TrustScore < 0 || *p.TrustScore > 1) {
		issues = append(issues, validationIssue{Path: "trustScore", Message: "trustScore must be between 0 and 1."})
	}
	if p.ConsequenceTier != "" && !validConsequenceTiers[p.ConsequenceTier] {
		issues = append(issues, validationIssue{Path: "consequenceTier", Message: "consequenceTier must be LOW, MEDIUM, HIGH, or CRITICAL."})
	}
	return issues
}

func (p contextBudgetRequest) validate() []validationIssue {
	var issues []validationIssue
	if strings.TrimSpace(p.SessionID) == "" {
		issues = append(issues, validationIssue{Path: "sessionId", Message: "sessionId is required."})
	}
	if strings.TrimSpace(p.AgentID) == "" {
		issues = append(issues, validationIssue{Path: "agentId", Message: "agentId is required."})
	}
	if strings.TrimSpace(p.Environment) == "" {
		issues = append(issues, validationIssue{Path: "environment", Message: "environment is required."})
	}
	if !validRuntimeStacks[p.RuntimeStack] {
		issues = append(issues, validationIssue{Path: "runtimeStack", Message: "runtimeStack must be a supported runtime stack."})
	}
	if !validContextBudgetEventTypes[p.EventType] {
		issues = append(issues, validationIssue{Path: "eventType", Message: "eventType must be one of: TOKEN_GROWTH, SUMMARIZATION_EVENT, CONTEXT_SOURCE_MIX, BUDGET_BREACH."})
	}
	if p.TokenCount == nil || *p.TokenCount < 0 {
		issues = append(issues, validationIssue{Path: "tokenCount", Message: "tokenCount must be a non-negative integer."})
	}
	if p.GovernanceAction != "" && !validTrustActions[p.GovernanceAction] {
		issues = append(issues, validationIssue{Path: "governanceAction", Message: "governanceAction must be ALLOW, WARN, ESCALATE, or REVIEW."})
	}
	return issues
}

func (s *Server) ingestTrustScoreWithOps(ctx context.Context, auth gatewayInternalAuth, payload trustIngestRequest) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var previous *float64
	err = tx.QueryRow(ctx, `
		SELECT trust_score::float8
		FROM agt_trust_score_event
		WHERE tenant_id = $1 AND workspace_id = $2 AND agent_id = $3
		ORDER BY created_at DESC
		LIMIT 1
	`, auth.TenantID, auth.WorkspaceID, payload.AgentID).Scan(&previous)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var delta *float64
	if previous != nil && payload.TrustScore != nil {
		value := *payload.TrustScore - *previous
		delta = &value
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO agt_trust_score_event (
			tenant_id, workspace_id, agent_id, environment, runtime_stack,
			trust_score, previous_score, delta, source, source_ref, reason
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, nullif($10, ''), nullif($11, ''))
	`, auth.TenantID, auth.WorkspaceID, payload.AgentID, payload.Environment, payload.RuntimeStack,
		payload.TrustScore, previous, delta, payload.Source, payload.SourceRef, payload.Reason)
	if err != nil {
		return err
	}
	if err := appendGenericOperationsLogTx(ctx, tx, auth.TenantID, auth.WorkspaceID, "TRUST_SCORE_CHANGE", payload.AgentID, "agt_trust_score_event", auth.ActorID, map[string]any{
		"agentId": payload.AgentID, "environment": payload.Environment, "runtimeStack": payload.RuntimeStack,
		"trustScore": payload.TrustScore, "source": payload.Source, "sourceRef": payload.SourceRef,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) evaluateTrustGovernanceForRequest(ctx context.Context, auth gatewayInternalAuth, payload trustEvaluateRequest) (trustEvaluateResult, error) {
	policies, err := s.listTrustPolicies(ctx, auth.TenantID, auth.WorkspaceID)
	if err != nil {
		return trustEvaluateResult{}, err
	}
	result := evaluateTrustGovernance(payload, policies)
	if result.Action != "ALLOW" {
		isContextBreach := payload.ContextTokens != nil && strings.Contains(result.Reason, "token count")
		if isContextBreach && payload.SessionID != "" && payload.AgentID != "" && payload.Environment != "" && validRuntimeStacks[payload.RuntimeStack] {
			eventType := "TOKEN_GROWTH"
			if result.Action == "ESCALATE" {
				eventType = "BUDGET_BREACH"
			}
			_, _ = s.insertContextBudgetEvent(ctx, auth, contextBudgetRequest{
				SessionID: payload.SessionID, AgentID: payload.AgentID, Environment: payload.Environment, RuntimeStack: payload.RuntimeStack,
				EventType: eventType, TokenCount: payload.ContextTokens, BudgetLimit: payload.BudgetLimit,
				BudgetUtilization: result.BudgetUtilization, GovernanceAction: result.Action, PolicyRef: stringPtrValue(result.MatchedPolicyID),
			})
		}
		eventType := "TRUST_POLICY_BREACH"
		if isContextBreach {
			eventType = "CONTEXT_BUDGET_BREACH"
		}
		_ = s.appendGenericOperationsLog(ctx, auth.TenantID, auth.WorkspaceID, eventType, stringPtrValue(result.MatchedPolicyID), "trust_calibration_policy", auth.ActorID, map[string]any{
			"action": result.Action, "reason": result.Reason, "trustScore": payload.TrustScore, "contextTokens": payload.ContextTokens,
			"budgetUtilization": result.BudgetUtilization, "matchedPolicyId": result.MatchedPolicyID, "agentClass": payload.AgentClass,
			"environment": payload.Environment, "connector": payload.Connector, "consequenceTier": payload.ConsequenceTier,
			"agentId": payload.AgentID, "sessionId": payload.SessionID,
		})
	}
	return result, nil
}

func (s *Server) ingestContextBudgetWithOps(ctx context.Context, auth gatewayInternalAuth, payload contextBudgetRequest) (string, error) {
	if payload.BudgetUtilization == nil && payload.BudgetLimit != nil && *payload.BudgetLimit > 0 && payload.TokenCount != nil {
		value := float64(*payload.TokenCount) / float64(*payload.BudgetLimit)
		payload.BudgetUtilization = &value
	}
	id, err := s.insertContextBudgetEvent(ctx, auth, payload)
	if err != nil {
		return "", err
	}
	if payload.EventType == "BUDGET_BREACH" {
		if err := s.appendGenericOperationsLog(ctx, auth.TenantID, auth.WorkspaceID, "CONTEXT_BUDGET_BREACH", id, "context_budget_event", auth.ActorID, map[string]any{
			"sessionId": payload.SessionID, "agentId": payload.AgentID, "environment": payload.Environment,
			"runtimeStack": payload.RuntimeStack, "tokenCount": payload.TokenCount,
			"budgetLimit": payload.BudgetLimit, "budgetUtilization": payload.BudgetUtilization,
		}); err != nil {
			return "", err
		}
	}
	return id, nil
}

func (s *Server) insertContextBudgetEvent(ctx context.Context, auth gatewayInternalAuth, payload contextBudgetRequest) (string, error) {
	mixBytes, err := json.Marshal(map[string]any{})
	if err != nil {
		return "", err
	}
	if payload.ContextSourceMix != nil {
		mixBytes, err = json.Marshal(payload.ContextSourceMix)
		if err != nil {
			return "", err
		}
	}
	var id string
	err = s.db.QueryRow(ctx, `
		INSERT INTO context_budget_event (
			tenant_id, workspace_id, session_id, agent_id, environment, runtime_stack,
			event_type, token_count, token_delta, context_source_mix,
			budget_limit, budget_utilization, governance_action, policy_ref
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10::jsonb,
			$11, $12, nullif($13, ''), nullif($14, '')::uuid
		)
		RETURNING id::text
	`, auth.TenantID, auth.WorkspaceID, payload.SessionID, payload.AgentID, payload.Environment, payload.RuntimeStack,
		payload.EventType, payload.TokenCount, payload.TokenDelta, string(mixBytes),
		payload.BudgetLimit, payload.BudgetUtilization, payload.GovernanceAction, payload.PolicyRef).Scan(&id)
	return id, err
}

func (s *Server) listTrustPolicies(ctx context.Context, tenantID string, workspaceID string) ([]trustPolicy, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, name, enabled, agent_class, environment, connector, consequence_tier,
		       warn_threshold::float8, escalate_threshold::float8, review_threshold::float8,
		       context_warn_threshold, context_escalate_threshold
		FROM trust_calibration_policy
		WHERE tenant_id = $1
			AND (workspace_id = $2 OR workspace_id IS NULL)
			AND enabled = true
		ORDER BY created_at DESC
		LIMIT 100
	`, tenantID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var policies []trustPolicy
	for rows.Next() {
		var p trustPolicy
		if err := rows.Scan(&p.ID, &p.Name, &p.Enabled, &p.AgentClass, &p.Environment, &p.Connector, &p.ConsequenceTier,
			&p.WarnThreshold, &p.EscalateThreshold, &p.ReviewThreshold, &p.ContextWarnThreshold, &p.ContextEscalateThreshold); err != nil {
			return nil, err
		}
		policies = append(policies, p)
	}
	return policies, rows.Err()
}

func evaluateTrustGovernance(input trustEvaluateRequest, policies []trustPolicy) trustEvaluateResult {
	now := time.Now().UTC().Format(time.RFC3339)
	var budgetUtilization *float64
	if input.ContextTokens != nil && input.BudgetLimit != nil && *input.BudgetLimit > 0 {
		value := float64(*input.ContextTokens) / float64(*input.BudgetLimit)
		budgetUtilization = &value
	}
	result := trustEvaluateResult{
		Action: "ALLOW", Reason: "Trust score and context budget within policy bounds.",
		TrustScore: input.TrustScore, ContextTokens: input.ContextTokens, BudgetUtilization: budgetUtilization,
		RecommendedRiskLevel: "LOW", EvaluatedAt: now,
	}
	for _, policy := range policies {
		if !policyMatches(policy, input) {
			continue
		}
		if input.TrustScore != nil {
			if policy.EscalateThreshold != nil && *input.TrustScore < *policy.EscalateThreshold {
				result.Action, result.Reason, result.RecommendedRiskLevel = "ESCALATE", fmt.Sprintf("Trust score %.3f is below escalation threshold %.3f.", *input.TrustScore, *policy.EscalateThreshold), "HIGH"
				result.MatchedPolicyID, result.MatchedPolicyName = &policy.ID, &policy.Name
				break
			}
			if policy.ReviewThreshold != nil && *input.TrustScore < *policy.ReviewThreshold {
				result.Action, result.Reason, result.RecommendedRiskLevel = "REVIEW", fmt.Sprintf("Trust score %.3f is below review threshold %.3f.", *input.TrustScore, *policy.ReviewThreshold), "MEDIUM"
				result.MatchedPolicyID, result.MatchedPolicyName = &policy.ID, &policy.Name
			}
			if policy.WarnThreshold != nil && *input.TrustScore < *policy.WarnThreshold && result.Action == "ALLOW" {
				result.Action, result.Reason, result.RecommendedRiskLevel = "WARN", fmt.Sprintf("Trust score %.3f is below warn threshold %.3f.", *input.TrustScore, *policy.WarnThreshold), "MEDIUM"
				result.MatchedPolicyID, result.MatchedPolicyName = &policy.ID, &policy.Name
			}
		}
		if input.ContextTokens != nil {
			if policy.ContextEscalateThreshold != nil && *input.ContextTokens > *policy.ContextEscalateThreshold {
				result.Action, result.Reason, result.RecommendedRiskLevel = "ESCALATE", fmt.Sprintf("Context token count %d exceeds escalation threshold %d.", *input.ContextTokens, *policy.ContextEscalateThreshold), "HIGH"
				result.MatchedPolicyID, result.MatchedPolicyName = &policy.ID, &policy.Name
				break
			}
			if policy.ContextWarnThreshold != nil && *input.ContextTokens > *policy.ContextWarnThreshold && result.Action == "ALLOW" {
				result.Action, result.Reason, result.RecommendedRiskLevel = "WARN", fmt.Sprintf("Context token count %d exceeds warn threshold %d.", *input.ContextTokens, *policy.ContextWarnThreshold), "MEDIUM"
				result.MatchedPolicyID, result.MatchedPolicyName = &policy.ID, &policy.Name
			}
		}
	}
	return result
}

func policyMatches(policy trustPolicy, input trustEvaluateRequest) bool {
	if policy.AgentClass != nil && *policy.AgentClass != input.AgentClass {
		return false
	}
	if policy.Environment != nil && *policy.Environment != input.Environment {
		return false
	}
	if policy.Connector != nil && *policy.Connector != input.Connector {
		return false
	}
	if policy.ConsequenceTier != nil && *policy.ConsequenceTier != input.ConsequenceTier {
		return false
	}
	return true
}

func decodeJSONRequest(w http.ResponseWriter, r *http.Request, out any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.UseNumber()
	if err := decoder.Decode(out); err != nil {
		return errors.New("Request body must be JSON.")
	}
	return nil
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
