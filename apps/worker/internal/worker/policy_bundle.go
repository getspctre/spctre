package worker

import (
	"context"
	"encoding/json"
	"fmt"
)

// Loads the published, composed rules the gateway enforces.
//
// Rules come from policy_rule, which since migration 007 carries the
// semanticChecks and parameterConstraints the evaluator matches on. That is
// what makes this possible at all: recovering those from
// policy_revision.source_document would need the TypeScript AGT parser, which
// this service has no equivalent of.
//
// The layer query and ordering mirror listPublishedCompositionLayers in
// apps/web. The ordered layers are passed to the Rust kernel, which alone
// composes them before enforcement.

// errPolicyRulesUnmaterialized reports a revision whose rules still carry NULL
// matchers — written before migration 007 and not yet processed by
// scripts/backfill-policy-rule-matchers.mjs.
//
// The Node reader falls back to parsing source_document here. This service
// cannot, so it fails closed instead: evaluating such a rule would silently
// drop its thresholds and semantic checks and under-enforce, which is the exact
// failure this engine exists to prevent. Refusing the decision is the only
// honest option, and it is loud enough to prompt running the backfill.
type errPolicyRulesUnmaterialized struct {
	RevisionIDs []string
}

func (e *errPolicyRulesUnmaterialized) Error() string {
	return fmt.Sprintf(
		"policy rules are not materialised for %d revision(s) (%v); run scripts/backfill-policy-rule-matchers.mjs",
		len(e.RevisionIDs), e.RevisionIDs,
	)
}

// loadPublishedCompositionLayers mirrors the TypeScript query of the same name,
// including the scope ordering that decides which layer overrides which.
func (s *Server) loadPublishedCompositionLayers(
	ctx context.Context,
	tenantID, workspaceID string,
) ([]CompositionLayer, error) {
	rows, err := s.db.Query(ctx, `
		WITH latest_publish AS (
			SELECT DISTINCT ON (pp.branch_id)
				pp.branch_id, pp.revision_id, pp.published_at
			FROM policy_publish pp
			JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
			WHERE pp.tenant_id = $1
				AND (pp.workspace_id = $2 OR pb.scope = 'ORGANIZATION')
			ORDER BY pp.branch_id, pp.published_at DESC
		)
		SELECT lp.revision_id::text, pb.scope
		FROM latest_publish lp
		JOIN policy_branch pb ON pb.id = lp.branch_id AND pb.tenant_id = $1
		ORDER BY
			CASE pb.scope
				WHEN 'ORGANIZATION' THEN 1
				WHEN 'WORKSPACE' THEN 2
				WHEN 'ENVIRONMENT' THEN 3
				WHEN 'CONNECTOR' THEN 4
				ELSE 5
			END,
			lp.published_at ASC
	`, tenantID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type layerRef struct {
		revisionID string
		scope      string
	}
	var refs []layerRef
	for rows.Next() {
		var ref layerRef
		if err := rows.Scan(&ref.revisionID, &ref.scope); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(refs) == 0 {
		return nil, nil
	}

	revisionIDs := make([]string, 0, len(refs))
	for _, ref := range refs {
		revisionIDs = append(revisionIDs, ref.revisionID)
	}
	rulesByRevision, err := s.loadRulesForRevisions(ctx, tenantID, revisionIDs)
	if err != nil {
		return nil, err
	}

	layers := make([]CompositionLayer, 0, len(refs))
	for _, ref := range refs {
		layers = append(layers, CompositionLayer{
			Scope: ref.scope,
			Rules: rulesByRevision[ref.revisionID],
		})
	}
	return layers, nil
}

// loadRulesForRevisions reads materialised rules, failing closed on any
// revision that is not fully materialised.
func (s *Server) loadRulesForRevisions(
	ctx context.Context,
	tenantID string,
	revisionIDs []string,
) (map[string][]PolicyRule, error) {
	// A revision is only usable when *every* one of its rows has matchers. A
	// partially backfilled revision would otherwise contribute rules with their
	// thresholds and semantic checks stripped.
	unmaterialized, err := s.unmaterializedRevisions(ctx, tenantID, revisionIDs)
	if err != nil {
		return nil, err
	}
	if len(unmaterialized) > 0 {
		return nil, &errPolicyRulesUnmaterialized{RevisionIDs: unmaterialized}
	}

	rows, err := s.db.Query(ctx, `
		SELECT revision_id::text, stable_rule_id, title, effect,
		       domains, connectors, actions, immutable,
		       semantic_checks, parameter_constraints
		FROM policy_rule
		WHERE tenant_id = $1 AND revision_id = ANY($2)
		ORDER BY stable_rule_id
	`, tenantID, revisionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byRevision := make(map[string][]PolicyRule, len(revisionIDs))
	for rows.Next() {
		var revisionID string
		var rule PolicyRule
		var semanticChecks, parameterConstraints []byte
		if err := rows.Scan(
			&revisionID, &rule.StableRuleID, &rule.Title, &rule.Effect,
			&rule.Domains, &rule.Connectors, &rule.Actions, &rule.Immutable,
			&semanticChecks, &parameterConstraints,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(semanticChecks, &rule.SemanticChecks); err != nil {
			return nil, fmt.Errorf("rule %s: semantic_checks: %w", rule.StableRuleID, err)
		}
		if err := json.Unmarshal(parameterConstraints, &rule.ParameterConstraints); err != nil {
			return nil, fmt.Errorf("rule %s: parameter_constraints: %w", rule.StableRuleID, err)
		}
		byRevision[revisionID] = append(byRevision[revisionID], rule)
	}
	return byRevision, rows.Err()
}

func (s *Server) unmaterializedRevisions(
	ctx context.Context,
	tenantID string,
	revisionIDs []string,
) ([]string, error) {
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT revision_id::text
		FROM policy_rule
		WHERE tenant_id = $1 AND revision_id = ANY($2)
			AND (semantic_checks IS NULL OR parameter_constraints IS NULL)
	`, tenantID, revisionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pending []string
	for rows.Next() {
		var revisionID string
		if err := rows.Scan(&revisionID); err != nil {
			return nil, err
		}
		pending = append(pending, revisionID)
	}
	return pending, rows.Err()
}

// applyPublishedPolicyDecision folds the published-rule verdict into the
// threshold verdict, mirroring mergePublishedPolicyDecision in
// apps/web/lib/policy/published-enforcement.ts.
//
// A published DENY is absolute. A published ESCALATE only upgrades a threshold
// PROCEED and never downgrades an ABORT. ALLOW and WARN leave the threshold
// verdict alone.
func (s *Server) applyPublishedPolicyDecision(
	ctx context.Context,
	input GatewayDecisionRequest,
	auth authResult,
	decision GatewayDecision,
) (GatewayDecision, error) {
	if input.Connector == nil || input.Action == nil {
		return decision, nil
	}

	layers, err := s.loadPublishedCompositionLayers(ctx, auth.TenantID, auth.WorkspaceID)
	if err != nil {
		return decision, err
	}
	if len(layers) == 0 {
		return decision, nil
	}

	policyInput := PolicyEvaluationInput{
		Connector:      *input.Connector,
		Action:         *input.Action,
		Layers:         layers,
		ToolIntent:     derefString(input.ToolIntent),
		PlanSummary:    derefString(input.PlanSummary),
		ToolParameters: derefToolParameters(input.ToolParameters),
	}
	evaluated, err := evaluatePolicyRulesWithKernel(policyInput)
	if err != nil {
		return decision, fmt.Errorf("evaluate published policy kernel: %w", err)
	}

	switch evaluated.Status {
	case statusDeny:
		return GatewayDecision{
			Outcome:     "ABORT",
			Reason:      evaluated.Reason,
			RiskLevel:   "HIGH",
			ShouldQueue: false,
		}, nil
	case statusEscalate:
		if decision.Outcome != "PROCEED" {
			return decision, nil
		}
		return GatewayDecision{
			Outcome:     "ESCALATE",
			Reason:      evaluated.Reason,
			RiskLevel:   "HIGH",
			ShouldQueue: true,
			SLAHours:    intPtr(4),
		}, nil
	default:
		return decision, nil
	}
}

func derefToolParameters(value *map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	return *value
}
