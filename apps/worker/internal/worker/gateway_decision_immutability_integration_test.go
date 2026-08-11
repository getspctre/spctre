package worker

import (
	"context"
	"fmt"
	"testing"
)

// A gateway decision is an audit record. These tests pin the first-write-wins
// contract: a replay carrying the same (tenant_id, decision_id, artifact_hash)
// must resolve to the original row without rewriting it, and must never move a
// terminal escalation back into the review queue.
func TestGatewayDecisionReplayDoesNotRewriteRecord(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	s := testServer(pool)

	auth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID, PrincipalID: "principal-first"}
	request := validGatewayDecision()
	// persistGatewayDecision writes revision_id/branch_id as uuid; the shared
	// fixture carries readable placeholders, so persist without policy context.
	request.PolicyContext = nil
	request.DecisionID = "immutable-" + f.suffix

	first := GatewayDecision{Outcome: "ABORT", Reason: "original evaluation", RiskLevel: "HIGH"}
	firstID, err := s.persistGatewayDecision(ctx, request, auth, first, nil, nil)
	if err != nil {
		t.Fatalf("persist first decision: %v", err)
	}

	// Replay the same decision id with a materially different evaluation.
	replayAuth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID, PrincipalID: "principal-replay"}
	replay := GatewayDecision{Outcome: "PROCEED", Reason: "replayed evaluation", RiskLevel: "LOW"}
	replayID, err := s.persistGatewayDecision(ctx, request, replayAuth, replay, nil, nil)
	if err != nil {
		t.Fatalf("persist replayed decision: %v", err)
	}

	if replayID != firstID {
		t.Fatalf("replay must resolve to the original decision row: first=%s replay=%s", firstID, replayID)
	}

	var outcome, reason, riskLevel, evaluatedBy string
	if err := pool.QueryRow(ctx, `
		SELECT outcome, reason, risk_level, evaluated_by FROM gateway_decision WHERE id = $1
	`, firstID).Scan(&outcome, &reason, &riskLevel, &evaluatedBy); err != nil {
		t.Fatalf("read persisted decision: %v", err)
	}
	if outcome != "ABORT" || reason != "original evaluation" || riskLevel != "HIGH" {
		t.Fatalf("replay rewrote the audit record: outcome=%s reason=%s risk=%s", outcome, reason, riskLevel)
	}
	if evaluatedBy != "principal-first" {
		t.Fatalf("replay rewrote the actor: evaluated_by=%s", evaluatedBy)
	}

	// The divergent replay must remain inspectable rather than being dropped.
	var diverged int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM agt_operations_log
		WHERE tenant_id = $1 AND source_id = $2 AND event_type = 'GATEWAY_DECISION_REPLAY_DIVERGED'
	`, f.tenantID, request.DecisionID).Scan(&diverged); err != nil {
		t.Fatalf("count divergence events: %v", err)
	}
	if diverged != 1 {
		t.Fatalf("expected exactly one divergence audit event, got %d", diverged)
	}
}

func TestGatewayDecisionIdenticalReplayWritesNoDivergenceEvent(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	s := testServer(pool)

	auth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID, PrincipalID: "principal"}
	request := validGatewayDecision()
	request.PolicyContext = nil
	request.DecisionID = "identical-" + f.suffix
	decision := GatewayDecision{Outcome: "ABORT", Reason: "same", RiskLevel: "HIGH"}

	if _, err := s.persistGatewayDecision(ctx, request, auth, decision, nil, nil); err != nil {
		t.Fatalf("persist first decision: %v", err)
	}
	if _, err := s.persistGatewayDecision(ctx, request, auth, decision, nil, nil); err != nil {
		t.Fatalf("persist identical replay: %v", err)
	}

	var events int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM agt_operations_log
		WHERE tenant_id = $1 AND source_id = $2 AND event_type = 'GATEWAY_DECISION_REPLAY_DIVERGED'
	`, f.tenantID, request.DecisionID).Scan(&events); err != nil {
		t.Fatalf("count divergence events: %v", err)
	}
	if events != 0 {
		t.Fatalf("identical replay should write no divergence event, got %d", events)
	}
}

// A resolved escalation is a terminal human decision. Replaying the decision
// that raised it must not create a second approval opportunity.
func TestGatewayReplayDoesNotResurrectTerminalEscalation(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	s := testServer(pool)

	auth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID, PrincipalID: "principal"}
	slaHours := 4
	decision := GatewayDecision{
		Outcome:     "ESCALATE",
		Reason:      "needs review",
		RiskLevel:   "HIGH",
		ShouldQueue: true,
		SLAHours:    &slaHours,
	}

	for _, terminal := range []string{"RESOLVED", "EXPIRED"} {
		t.Run(terminal, func(t *testing.T) {
			request := validGatewayDecision()
			request.PolicyContext = nil
			request.DecisionID = fmt.Sprintf("escalation-%s-%s", terminal, f.suffix)

			if _, err := s.persistGatewayDecision(ctx, request, auth, decision, nil, nil); err != nil {
				t.Fatalf("persist escalating decision: %v", err)
			}

			// A reviewer (or the SLA sweep) closes the escalation.
			if _, err := pool.Exec(ctx, `
				UPDATE gateway_escalation_queue SET status = $3
				WHERE tenant_id = $1 AND decision_id = $2
			`, f.tenantID, request.DecisionID, terminal); err != nil {
				t.Fatalf("close escalation: %v", err)
			}

			if _, err := s.persistGatewayDecision(ctx, request, auth, decision, nil, nil); err != nil {
				t.Fatalf("persist replayed escalating decision: %v", err)
			}

			var status string
			if err := pool.QueryRow(ctx, `
				SELECT status FROM gateway_escalation_queue WHERE tenant_id = $1 AND decision_id = $2
			`, f.tenantID, request.DecisionID).Scan(&status); err != nil {
				t.Fatalf("read escalation status: %v", err)
			}
			if status != terminal {
				t.Fatalf("replay resurrected a %s escalation to %s", terminal, status)
			}
		})
	}
}

// An escalation that is still open may legitimately be refreshed by a retry.
func TestGatewayReplayRefreshesOpenEscalation(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	s := testServer(pool)

	auth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID, PrincipalID: "principal"}
	slaHours := 4
	decision := GatewayDecision{
		Outcome:     "ESCALATE",
		Reason:      "needs review",
		RiskLevel:   "HIGH",
		ShouldQueue: true,
		SLAHours:    &slaHours,
	}
	request := validGatewayDecision()
	request.PolicyContext = nil
	request.DecisionID = "open-escalation-" + f.suffix

	if _, err := s.persistGatewayDecision(ctx, request, auth, decision, nil, nil); err != nil {
		t.Fatalf("persist escalating decision: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE gateway_escalation_queue SET status = 'IN_REVIEW'
		WHERE tenant_id = $1 AND decision_id = $2
	`, f.tenantID, request.DecisionID); err != nil {
		t.Fatalf("claim escalation: %v", err)
	}

	if _, err := s.persistGatewayDecision(ctx, request, auth, decision, nil, nil); err != nil {
		t.Fatalf("persist replayed escalating decision: %v", err)
	}

	var status string
	if err := pool.QueryRow(ctx, `
		SELECT status FROM gateway_escalation_queue WHERE tenant_id = $1 AND decision_id = $2
	`, f.tenantID, request.DecisionID).Scan(&status); err != nil {
		t.Fatalf("read escalation status: %v", err)
	}
	if status != "PENDING" {
		t.Fatalf("a retry should refresh a non-terminal escalation, got status=%s", status)
	}
}
