package worker

import (
	"context"
	"fmt"
	"testing"
)

// Exercises published Blueprint limits against a real Postgres session. It
// shares the optional DB fixture used by gateway credential integration tests.
func TestGatewayBlueprintSafeguardsIntegration(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	const agentID, sessionID = "agent-loop-test", "run-loop-test"

	var blueprintID, revisionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_blueprint (tenant_id, workspace_id, name, agent_id, created_by)
		VALUES ($1, $2, 'loop blueprint', $3, 'itest') RETURNING id
	`, f.tenantID, f.workspaceID, agentID).Scan(&blueprintID); err != nil {
		t.Fatalf("insert blueprint: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_blueprint_revision (tenant_id, blueprint_id, definition, definition_hash, message, author_id, status, published_at)
		VALUES ($1, $2, '{"budgets":{"maxToolCallsPerSession":2,"maxTokensPerTurn":100}}'::jsonb, 'sha256:loop', 'itest', 'itest', 'PUBLISHED', now())
		RETURNING id
	`, f.tenantID, blueprintID).Scan(&revisionID); err != nil {
		t.Fatalf("insert blueprint revision: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE agent_blueprint SET active_revision_id = $1 WHERE id = $2`, revisionID, blueprintID); err != nil {
		t.Fatalf("activate blueprint revision: %v", err)
	}

	contextBudget := 101
	request := validGatewayDecision()
	request.AgentID, request.SessionID, request.ContextBudget = strPtr(agentID), strPtr(sessionID), &contextBudget
	s := testServer(pool)
	decision, telemetry, err := s.applyGatewayBlueprintSafeguards(ctx, request, authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID}, GatewayDecision{Outcome: "PROCEED"})
	if err != nil || decision.Outcome != "ESCALATE" {
		t.Fatalf("expected context-budget escalation, decision=%#v err=%v", decision, err)
	}
	if telemetry == nil || telemetry.BlueprintRevisionID != revisionID || telemetry.ContextBudget == nil || *telemetry.ContextBudget != 101 {
		t.Fatalf("expected persisted-safe safeguard telemetry, got %#v", telemetry)
	}

	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, `
			INSERT INTO gateway_decision (tenant_id, workspace_id, decision_id, artifact_hash, outcome, reason, evaluated_by, agent_id, session_id)
			VALUES ($1, $2, $3, 'sha256:itest', 'PROCEED', 'itest', 'itest', $4, $5)
		`, f.tenantID, f.workspaceID, fmt.Sprintf("loop-%s-%d", f.suffix, i), agentID, sessionID); err != nil {
			t.Fatalf("insert prior session decision: %v", err)
		}
	}
	contextBudget = 100
	decision, telemetry, err = s.applyGatewayBlueprintSafeguards(ctx, request, authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID}, GatewayDecision{Outcome: "PROCEED"})
	if err != nil || decision.Outcome != "ABORT" {
		t.Fatalf("expected session-limit abort, decision=%#v err=%v", decision, err)
	}
	if telemetry == nil || telemetry.PriorToolCalls == nil || *telemetry.PriorToolCalls != 2 || telemetry.Outcome != "ABORT" {
		t.Fatalf("expected abort telemetry with evaluated count, got %#v", telemetry)
	}
}

func strPtr(value string) *string { return &value }
