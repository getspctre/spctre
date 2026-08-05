package worker

import (
	"context"
	"errors"
	"testing"
)

// End-to-end cover for the gap this closes: a delegated decide ran only the
// threshold evaluator, so an authored ESCALATE was recorded as PROCEED.
func TestPublishedPolicyDecisionIntegration(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	s := testServer(pool)
	auth := authResult{TenantID: f.tenantID, WorkspaceID: f.workspaceID}

	// A published WORKSPACE branch carrying one ESCALATE rule, materialised the
	// way toPolicyRuleRows writes it: matchers present, [] rather than NULL.
	var branchID, revisionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO policy_branch (tenant_id, workspace_id, name, scope, created_by)
		VALUES ($1, $2, 'policy-decision-test', 'WORKSPACE', 'itest') RETURNING id
	`, f.tenantID, f.workspaceID).Scan(&branchID); err != nil {
		t.Fatalf("insert branch: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO policy_revision (tenant_id, workspace_id, branch_id, source_format, source_path, source_document, source_hash, author_id, message)
		VALUES ($1, $2, $3, 'AGT_YAML', 'policy.yaml', '{}'::jsonb, 'sha256:test', 'itest', 'itest')
		RETURNING id
	`, f.tenantID, f.workspaceID, branchID).Scan(&revisionID); err != nil {
		t.Fatalf("insert revision: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO policy_rule (
			tenant_id, workspace_id, branch_id, revision_id, stable_rule_id, title, effect,
			source_path, domains, connectors, actions, immutable,
			semantic_checks, parameter_constraints
		) VALUES (
			$1, $2, $3, $4, 'scout.escalate_brief_file',
			'Every filed brief escalates for human review', 'ESCALATE',
			'policy.yaml', '{}', '{acquisition-scout}', '{brief.file}', false,
			'[]'::jsonb, '[]'::jsonb
		)
	`, f.tenantID, f.workspaceID, branchID, revisionID); err != nil {
		t.Fatalf("insert rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO policy_publish (tenant_id, workspace_id, branch_id, revision_id, environment, runtime_stack, artifact_hash, published_by)
		VALUES ($1, $2, $3, $4, 'production', 'CUSTOM', 'sha256:test', 'itest')
	`, f.tenantID, f.workspaceID, branchID, revisionID); err != nil {
		t.Fatalf("insert publish: %v", err)
	}

	request := func(connector, action string) GatewayDecisionRequest {
		req := validGatewayDecision()
		req.Connector, req.Action = strPtr(connector), strPtr(action)
		return req
	}

	t.Run("published ESCALATE upgrades a threshold PROCEED", func(t *testing.T) {
		decision, err := s.applyPublishedPolicyDecision(
			ctx, request("acquisition-scout", "brief.file"), auth,
			GatewayDecision{Outcome: "PROCEED"})
		if err != nil {
			t.Fatalf("policy decision: %v", err)
		}
		if decision.Outcome != "ESCALATE" {
			t.Errorf("outcome = %q, want ESCALATE (%s)", decision.Outcome, decision.Reason)
		}
		if !decision.ShouldQueue {
			t.Error("an escalated action must be queued for review")
		}
	})

	t.Run("published ESCALATE never downgrades a threshold ABORT", func(t *testing.T) {
		decision, err := s.applyPublishedPolicyDecision(
			ctx, request("acquisition-scout", "brief.file"), auth,
			GatewayDecision{Outcome: "ABORT", Reason: "threshold abort"})
		if err != nil {
			t.Fatalf("policy decision: %v", err)
		}
		if decision.Outcome != "ABORT" {
			t.Errorf("outcome = %q, want ABORT preserved", decision.Outcome)
		}
	})

	t.Run("an action no rule matches is left alone", func(t *testing.T) {
		decision, err := s.applyPublishedPolicyDecision(
			ctx, request("stripe", "charge"), auth, GatewayDecision{Outcome: "PROCEED"})
		if err != nil {
			t.Fatalf("policy decision: %v", err)
		}
		if decision.Outcome != "PROCEED" {
			t.Errorf("outcome = %q, want PROCEED", decision.Outcome)
		}
	})

	// The Node reader parses source_document for unmaterialised revisions. This
	// service has no parser, so it must refuse rather than evaluate a rule whose
	// matchers were silently dropped.
	t.Run("fails closed when rules are not materialised", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `
			UPDATE policy_rule SET semantic_checks = NULL, parameter_constraints = NULL
			WHERE tenant_id = $1 AND revision_id = $2
		`, f.tenantID, revisionID); err != nil {
			t.Fatalf("unmaterialise: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(ctx, `
				UPDATE policy_rule SET semantic_checks = '[]'::jsonb, parameter_constraints = '[]'::jsonb
				WHERE tenant_id = $1 AND revision_id = $2
			`, f.tenantID, revisionID)
		})

		_, err := s.applyPublishedPolicyDecision(
			ctx, request("acquisition-scout", "brief.file"), auth,
			GatewayDecision{Outcome: "PROCEED"})
		var unmaterialized *errPolicyRulesUnmaterialized
		if !errors.As(err, &unmaterialized) {
			t.Fatalf("expected errPolicyRulesUnmaterialized, got %v", err)
		}
		if len(unmaterialized.RevisionIDs) == 0 {
			t.Error("error should name the offending revisions")
		}
	})
}
