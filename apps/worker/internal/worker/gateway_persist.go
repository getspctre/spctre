package worker

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) persistGatewayDecision(ctx context.Context, record GatewayDecisionRequest, auth authResult, decision GatewayDecision, safeguardTelemetry *gatewaySafeguardTelemetry, provenance *policyKernelProvenance) (string, error) {
	firstContext := RuntimePolicyContext{}
	hasContext := len(record.PolicyContext) > 0
	if hasContext {
		firstContext = record.PolicyContext[0]
	}

	tx, err := s.beginTenantTx(ctx, auth.TenantID)
	if err != nil {
		return "", err
	}
	defer s.rollbackAfterFailure(ctx, tx, "persist_gateway_decision")

	var toolParamsJSON *string
	if record.ToolParameters != nil {
		if bytes, err := json.Marshal(record.ToolParameters); err == nil {
			s := string(bytes)
			toolParamsJSON = &s
		}
	}
	telemetryJSON := "{}"
	if safeguardTelemetry != nil {
		if bytes, err := json.Marshal(safeguardTelemetry); err == nil {
			telemetryJSON = string(bytes)
		} else {
			return "", err
		}
	}

	// A gateway decision is an audit record: the first evaluation wins and is
	// never rewritten. A retry or replay carrying the same
	// (tenant_id, decision_id, artifact_hash) returns the original row exactly.
	// The previous ON CONFLICT DO UPDATE rewrote outcome, reason, risk, actor,
	// tool parameters and evaluated_at, so a replay could silently restate what
	// the control plane had already decided and proved.
	var gatewayDecisionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO gateway_decision (
			tenant_id, workspace_id, decision_id, revision_id, branch_id,
			artifact_hash, outcome, reason, consequence, customer_tier,
			confidence, amount_usd, data_sensitivity, trust_score, context_budget,
			risk_level, evaluated_by, agent_id, session_id, tool_intent, plan_summary, tool_parameters, safeguard_telemetry,
			connector, action, policy_artifact_hash, policy_evaluator_version
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15,
			$16, $17, $18, $19, $20, $21, $22::jsonb, $23::jsonb,
			$24, $25, $26, $27
		)
		ON CONFLICT (tenant_id, decision_id, artifact_hash) DO NOTHING
		RETURNING id
	`, auth.TenantID, auth.WorkspaceID, record.DecisionID,
		nullableString(hasContext, firstContext.RevisionID), nullableString(hasContext, firstContext.BranchID),
		record.ArtifactHash, string(decision.Outcome), decision.Reason, record.Consequence, record.CustomerTier,
		record.Confidence, record.AmountUsd, record.DataSensitivity, record.TrustScore, record.ContextBudget,
		string(decision.RiskLevel), auth.PrincipalID, record.AgentID, record.SessionID, record.ToolIntent, record.PlanSummary, toolParamsJSON, telemetryJSON,
		record.Connector, record.Action, policyProvenanceHash(provenance), policyProvenanceEvaluator(provenance)).Scan(&gatewayDecisionID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Replay of an already-persisted decision. Read the original back so the
		// caller keeps operating on the decision of record.
		var persistedOutcome string
		if err := tx.QueryRow(ctx, `
			SELECT id, outcome FROM gateway_decision
			WHERE tenant_id = $1 AND decision_id = $2 AND artifact_hash = $3
		`, auth.TenantID, record.DecisionID, record.ArtifactHash).Scan(&gatewayDecisionID, &persistedOutcome); err != nil {
			return "", err
		}
		// First-write-wins must not silently discard a governance decision that
		// disagrees with the record. An identical replay is uninteresting and
		// writes nothing; a divergent one is retained as its own audit event so
		// the disagreement stays inspectable without mutating the original.
		if persistedOutcome != string(decision.Outcome) {
			s.logger.Warn("gateway decision replay diverged from persisted record",
				"decision_id", record.DecisionID,
				"persisted_outcome", persistedOutcome,
				"replayed_outcome", string(decision.Outcome))
			if err := appendGenericOperationsLogTx(ctx, tx, auth.TenantID, auth.WorkspaceID,
				"GATEWAY_DECISION_REPLAY_DIVERGED", record.DecisionID, "gateway_decision", auth.PrincipalID,
				map[string]any{
					"persistedOutcome": persistedOutcome,
					"replayedOutcome":  string(decision.Outcome),
					"replayedReason":   decision.Reason,
					"artifactHash":     record.ArtifactHash,
				}); err != nil {
				return "", err
			}
		}
	} else if err != nil {
		return "", err
	}

	if !decision.ShouldQueue {
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return gatewayDecisionID, nil
	}

	slaHours := 4
	if decision.SLAHours != nil {
		slaHours = *decision.SLAHours
	}
	escalationTag, err := tx.Exec(ctx, `
		INSERT INTO gateway_escalation_queue (
			tenant_id, workspace_id, gateway_decision_id, decision_id, revision_id,
			artifact_hash, status, sla_due_at, handoff_notes
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, 'PENDING', now() + ($7 * interval '1 hour'), $8
		)
		ON CONFLICT (tenant_id, decision_id)
		DO UPDATE SET
			gateway_decision_id = EXCLUDED.gateway_decision_id,
			revision_id = EXCLUDED.revision_id,
			artifact_hash = EXCLUDED.artifact_hash,
			status = 'PENDING',
			sla_due_at = EXCLUDED.sla_due_at,
			handoff_notes = EXCLUDED.handoff_notes,
			updated_at = now()
		-- A retry may refresh an open escalation, but must never resurrect a
		-- terminal human or SLA decision. That would create a second approval
		-- opportunity for the same decisionId and violates F3 terminal
		-- immutability. Mirrors the web fallback path in
		-- apps/web/lib/repositories/gateway/decisions.ts.
		WHERE gateway_escalation_queue.status NOT IN ('RESOLVED', 'EXPIRED')
	`, auth.TenantID, auth.WorkspaceID, gatewayDecisionID, record.DecisionID,
		nullableString(hasContext, firstContext.RevisionID), record.ArtifactHash, slaHours, decision.Reason)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	// The guard above left a terminal escalation untouched. Announcing it as a
	// newly created escalation would call reviewers back to a decision they have
	// already closed.
	if escalationTag.RowsAffected() == 0 {
		s.logger.Warn("gateway escalation not requeued: terminal escalation already exists",
			"decision_id", record.DecisionID)
		return gatewayDecisionID, nil
	}

	slaDueTime := time.Now().Add(time.Duration(slaHours) * time.Hour)
	actx := GoEscalationAlertContext{
		TenantID:        auth.TenantID,
		WorkspaceID:     auth.WorkspaceID,
		DecisionID:      record.DecisionID,
		RiskLevel:       string(decision.RiskLevel),
		Reason:          decision.Reason,
		SLADueAt:        slaDueTime.UTC().Format(time.RFC3339),
		Consequence:     record.Consequence,
		DataSensitivity: record.DataSensitivity,
		ToolIntent:      record.ToolIntent,
		PlanSummary:     record.PlanSummary,
	}
	s.spawn(func(ctx context.Context) { s.dispatchEscalationCreatedAlert(ctx, actx) })

	return gatewayDecisionID, nil
}

func (s *Server) appendGenericOperationsLog(ctx context.Context, tenantID string, workspaceID string, eventType string, sourceID string, sourceTable string, actorID string, payload map[string]any) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer s.rollbackAfterFailure(ctx, tx, "append_operations_log")

	if err := appendGenericOperationsLogTx(ctx, tx, tenantID, workspaceID, eventType, sourceID, sourceTable, actorID, payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func appendGenericOperationsLogTx(ctx context.Context, tx pgx.Tx, tenantID string, workspaceID string, eventType string, sourceID string, sourceTable string, actorID string, payload map[string]any) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	prevHash, err := operationsChainPrevHash(ctx, tx, tenantID)
	if err != nil {
		return err
	}

	contentHash := operationsContentHash(eventType, sourceID, sourceTable, actorID, payloadBytes, prevHash)
	var workspaceParam any = workspaceID
	if workspaceID == "" {
		workspaceParam = nil
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agt_operations_log (
			tenant_id, workspace_id, event_type, source_id, source_table,
			actor_id, payload, content_hash, prev_hash
		) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
	`, tenantID, workspaceParam, eventType, sourceID, sourceTable, actorID, string(payloadBytes), contentHash, prevHash); err != nil {
		return err
	}
	return advanceOperationsChainHead(ctx, tx, tenantID, contentHash)
}

// operationsChainPrevHash upserts + row-locks the tenant's operations-log
// chain-head row and returns its last_hash — the prev_hash the next entry must
// link to. The row lock serializes concurrent appends across the web and worker
// processes and gives an O(1) tail read, replacing the unlocked
// "ORDER BY created_at DESC LIMIT 1" scan that let concurrent/cross-process
// appends fork the chain. Mirrors migration 058 and the web appendOperationsLog.
// Callers MUST advance the head via advanceOperationsChainHead after inserting,
// in the same transaction. See database-optimizations-audit finding 6.
func operationsChainPrevHash(ctx context.Context, tx pgx.Tx, tenantID string) (*string, error) {
	var prevHash *string
	err := tx.QueryRow(ctx, `
		INSERT INTO agt_operations_log_chain_head (tenant_id, last_hash)
		VALUES ($1, NULL)
		ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
		RETURNING last_hash
	`, tenantID).Scan(&prevHash)
	return prevHash, err
}

// advanceOperationsChainHead moves the tenant's chain head to contentHash so the
// next append links to this entry. Must run in the same transaction as the insert.
func advanceOperationsChainHead(ctx context.Context, tx pgx.Tx, tenantID string, contentHash string) error {
	_, err := tx.Exec(ctx, `
		UPDATE agt_operations_log_chain_head
		SET last_hash = $2, updated_at = now()
		WHERE tenant_id = $1
	`, tenantID, contentHash)
	return err
}
