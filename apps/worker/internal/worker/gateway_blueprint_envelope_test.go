package worker

import (
	"context"
	"testing"
)

// TestBlueprintAllowsAction pins the envelope predicate against the TypeScript
// blueprintAllowsAction it mirrors. Pure logic, so it runs everywhere — the
// database-backed behaviour is covered separately below.
func TestBlueprintAllowsAction(t *testing.T) {
	connectors := []string{"acquisition-scout", "github"}
	tools := []string{"brief.file", "github.pull_request.create"}

	cases := []struct {
		name      string
		connector string
		action    string
		want      bool
	}{
		{"bare tool name matches", "acquisition-scout", "brief.file", true},
		{"connector-qualified tool matches", "github", "pull_request.create", true},
		{"undeclared connector is refused", "stripe", "brief.file", false},
		{"undeclared action is refused", "acquisition-scout", "brief.delete", false},
		{"declared action under wrong connector is refused", "github", "brief.file", true},
		{"empty connector list refuses everything", "", "brief.file", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := blueprintAllowsAction(connectors, tools, testCase.connector, testCase.action)
			if got != testCase.want {
				t.Errorf("blueprintAllowsAction(%q, %q) = %v, want %v",
					testCase.connector, testCase.action, got, testCase.want)
			}
		})
	}
}

// TestGatewayBlueprintEnvelopeIntegration covers the gap this closes: before
// it, the delegated decide path permitted connectors and tools the published
// Blueprint never declared.
func TestGatewayBlueprintEnvelopeIntegration(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	const agentID = "agent-envelope-test"

	var blueprintID, revisionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_blueprint (tenant_id, workspace_id, name, agent_id, created_by)
		VALUES ($1, $2, 'envelope blueprint', $3, 'itest') RETURNING id
	`, f.tenantID, f.workspaceID, agentID).Scan(&blueprintID); err != nil {
		t.Fatalf("insert blueprint: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO agent_blueprint_revision (tenant_id, blueprint_id, definition, definition_hash, message, author_id, status, published_at)
		VALUES ($1, $2, '{"connectors":["acquisition-scout"],"tools":["brief.file"]}'::jsonb, 'sha256:envelope', 'itest', 'itest', 'PUBLISHED', now())
		RETURNING id
	`, f.tenantID, blueprintID).Scan(&revisionID); err != nil {
		t.Fatalf("insert blueprint revision: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE agent_blueprint SET active_revision_id = $1 WHERE id = $2`, revisionID, blueprintID); err != nil {
		t.Fatalf("activate blueprint revision: %v", err)
	}

	s := testServer(pool)
	auth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID}

	request := func(connector, action string) GatewayDecisionRequest {
		req := validGatewayDecision()
		req.AgentID, req.Connector, req.Action = strPtr(agentID), strPtr(connector), strPtr(action)
		return req
	}

	t.Run("declared action proceeds", func(t *testing.T) {
		decision, err := s.applyGatewayBlueprintEnvelope(
			ctx, request("acquisition-scout", "brief.file"), auth, GatewayDecision{Outcome: "PROCEED"})
		if err != nil {
			t.Fatalf("envelope: %v", err)
		}
		if decision.Outcome != "PROCEED" {
			t.Errorf("outcome = %q, want PROCEED (%s)", decision.Outcome, decision.Reason)
		}
	})

	t.Run("undeclared connector aborts", func(t *testing.T) {
		decision, err := s.applyGatewayBlueprintEnvelope(
			ctx, request("stripe", "charge"), auth, GatewayDecision{Outcome: "PROCEED"})
		if err != nil {
			t.Fatalf("envelope: %v", err)
		}
		if decision.Outcome != "ABORT" {
			t.Errorf("outcome = %q, want ABORT", decision.Outcome)
		}
	})

	// The check runs last and unconditionally, so it must override a decision
	// that an earlier stage escalated rather than leaving it queued for review.
	t.Run("overrides an earlier ESCALATE", func(t *testing.T) {
		decision, err := s.applyGatewayBlueprintEnvelope(
			ctx, request("stripe", "charge"), auth,
			GatewayDecision{Outcome: "ESCALATE", ShouldQueue: true})
		if err != nil {
			t.Fatalf("envelope: %v", err)
		}
		if decision.Outcome != "ABORT" {
			t.Errorf("outcome = %q, want ABORT", decision.Outcome)
		}
		if decision.ShouldQueue {
			t.Error("an aborted action must not be queued for review")
		}
	})

	t.Run("agent without a published blueprint is unconstrained", func(t *testing.T) {
		req := validGatewayDecision()
		req.AgentID, req.Connector, req.Action = strPtr("agent-with-no-blueprint"), strPtr("stripe"), strPtr("charge")
		decision, err := s.applyGatewayBlueprintEnvelope(ctx, req, auth, GatewayDecision{Outcome: "PROCEED"})
		if err != nil {
			t.Fatalf("envelope: %v", err)
		}
		if decision.Outcome != "PROCEED" {
			t.Errorf("outcome = %q, want PROCEED", decision.Outcome)
		}
	})
}
