package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type gatewaySafeguardTelemetry struct {
	AgentID             string `json:"agentId"`
	SessionID           string `json:"sessionId"`
	BlueprintRevisionID string `json:"blueprintRevisionId"`
	MaxToolCalls        *int   `json:"maxToolCallsPerSession,omitempty"`
	MaxTokensPerTurn    *int   `json:"maxTokensPerTurn,omitempty"`
	PriorToolCalls      *int   `json:"priorToolCalls,omitempty"`
	ContextBudget       *int   `json:"contextBudget,omitempty"`
	Outcome             string `json:"outcome"`
	PayloadHash         string `json:"payloadHash,omitempty"`
	PayloadBytes        int    `json:"payloadBytes,omitempty"`
	PayloadOutcome      string `json:"payloadOutcome,omitempty"`
}

// applyGatewayPayloadGuardrail mirrors the bounded TypeScript guardrail at the
// Go gateway boundary and retains only a hash/size in durable telemetry.
func applyGatewayPayloadGuardrail(input GatewayDecisionRequest, decision GatewayDecision) (GatewayDecision, *gatewaySafeguardTelemetry) {
	if decision.Outcome != "PROCEED" || input.ToolParameters == nil {
		return decision, nil
	}
	payload, err := json.Marshal(*input.ToolParameters)
	if err != nil {
		return GatewayDecision{Outcome: "ABORT", Reason: "Gateway aborted action: tool parameters could not be safely inspected.", RiskLevel: "HIGH", ShouldQueue: false}, &gatewaySafeguardTelemetry{PayloadOutcome: "UNSERIALIZABLE"}
	}
	hash := sha256.Sum256(payload)
	telemetry := &gatewaySafeguardTelemetry{PayloadHash: "sha256:" + hex.EncodeToString(hash[:]), PayloadBytes: len(payload), PayloadOutcome: "ALLOW"}
	if len(payload) > 32_768 {
		decision = GatewayDecision{Outcome: "ABORT", Reason: "Gateway aborted action: connector payload exceeds the 32 KiB governed inspection limit.", RiskLevel: "HIGH", ShouldQueue: false}
		telemetry.PayloadOutcome = "DENY"
	}
	return decision, telemetry
}

func mergeGatewaySafeguardTelemetry(primary, secondary *gatewaySafeguardTelemetry) *gatewaySafeguardTelemetry {
	if primary == nil {
		return secondary
	}
	if secondary == nil {
		return primary
	}
	primary.PayloadHash, primary.PayloadBytes, primary.PayloadOutcome = secondary.PayloadHash, secondary.PayloadBytes, secondary.PayloadOutcome
	return primary
}

// applyGatewayBlueprintSafeguards keeps loop controls bound to the published
// Blueprint, never thresholds supplied by a runtime request.
func (s *Server) applyGatewayBlueprintSafeguards(ctx context.Context, input GatewayDecisionRequest, auth authResult, decision GatewayDecision) (GatewayDecision, *gatewaySafeguardTelemetry, error) {
	if decision.Outcome != "PROCEED" || input.AgentID == nil || input.SessionID == nil {
		return decision, nil, nil
	}

	var revisionID string
	var maxToolCalls, maxTokens *int
	err := s.db.QueryRow(ctx, `
		SELECT
			r.id::text,
			NULLIF(r.definition->'budgets'->>'maxToolCallsPerSession', '')::int,
			NULLIF(r.definition->'budgets'->>'maxTokensPerTurn', '')::int
		FROM agent_blueprint b
		JOIN agent_blueprint_revision r ON r.id = b.active_revision_id AND r.tenant_id = b.tenant_id
		WHERE b.tenant_id = $1 AND b.workspace_id = $2 AND b.agent_id = $3 AND r.status = 'PUBLISHED'
	`, auth.TenantID, auth.WorkspaceID, *input.AgentID).Scan(&revisionID, &maxToolCalls, &maxTokens)
	if err == pgx.ErrNoRows {
		return decision, nil, nil
	}
	if err != nil {
		return decision, nil, err
	}
	telemetry := &gatewaySafeguardTelemetry{AgentID: *input.AgentID, SessionID: *input.SessionID, BlueprintRevisionID: revisionID, MaxToolCalls: maxToolCalls, MaxTokensPerTurn: maxTokens, ContextBudget: input.ContextBudget}

	if maxTokens != nil && input.ContextBudget != nil && *input.ContextBudget > *maxTokens {
		decision = GatewayDecision{Outcome: "ESCALATE", Reason: fmt.Sprintf("Gateway escalated action: context budget %d exceeds published Blueprint limit %d.", *input.ContextBudget, *maxTokens), RiskLevel: "HIGH", ShouldQueue: true, SLAHours: intPtr(4)}
		telemetry.Outcome = string(decision.Outcome)
		return decision, telemetry, nil
	}
	if maxToolCalls == nil {
		telemetry.Outcome = string(decision.Outcome)
		return decision, telemetry, nil
	}
	var prior int
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM gateway_decision
		WHERE tenant_id = $1 AND workspace_id = $2 AND agent_id = $3 AND session_id = $4
	`, auth.TenantID, auth.WorkspaceID, *input.AgentID, *input.SessionID).Scan(&prior); err != nil {
		return decision, nil, err
	}
	telemetry.PriorToolCalls = &prior
	if prior >= *maxToolCalls {
		decision = GatewayDecision{Outcome: "ABORT", Reason: fmt.Sprintf("Gateway aborted action: session has reached published Blueprint tool-call limit %d.", *maxToolCalls), RiskLevel: "HIGH", ShouldQueue: false}
	}
	telemetry.Outcome = string(decision.Outcome)
	return decision, telemetry, nil
}

func intPtr(value int) *int { return &value }
