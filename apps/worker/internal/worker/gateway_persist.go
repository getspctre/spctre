package worker

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) persistGatewayDecision(ctx context.Context, record GatewayDecisionRequest, auth authResult, decision GatewayDecision, safeguardTelemetry *gatewaySafeguardTelemetry) (string, error) {
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

	var gatewayDecisionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO gateway_decision (
			tenant_id, workspace_id, decision_id, revision_id, branch_id,
			artifact_hash, outcome, reason, consequence, customer_tier,
			confidence, amount_usd, data_sensitivity, trust_score, context_budget,
			risk_level, evaluated_by, agent_id, session_id, tool_intent, plan_summary, tool_parameters, safeguard_telemetry
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15,
			$16, $17, $18, $19, $20, $21, $22::jsonb, $23::jsonb
		)
		ON CONFLICT (tenant_id, decision_id, artifact_hash)
		DO UPDATE SET
			outcome = EXCLUDED.outcome,
			reason = EXCLUDED.reason,
			consequence = EXCLUDED.consequence,
			customer_tier = EXCLUDED.customer_tier,
			confidence = EXCLUDED.confidence,
			amount_usd = EXCLUDED.amount_usd,
			data_sensitivity = EXCLUDED.data_sensitivity,
			trust_score = EXCLUDED.trust_score,
			context_budget = EXCLUDED.context_budget,
			risk_level = EXCLUDED.risk_level,
			evaluated_by = EXCLUDED.evaluated_by,
			agent_id = EXCLUDED.agent_id,
			session_id = EXCLUDED.session_id,
			tool_intent = EXCLUDED.tool_intent,
			plan_summary = EXCLUDED.plan_summary,
			tool_parameters = EXCLUDED.tool_parameters,
			safeguard_telemetry = EXCLUDED.safeguard_telemetry,
			evaluated_at = now()
		RETURNING id
	`, auth.TenantID, auth.WorkspaceID, record.DecisionID,
		nullableString(hasContext, firstContext.RevisionID), nullableString(hasContext, firstContext.BranchID),
		record.ArtifactHash, string(decision.Outcome), decision.Reason, record.Consequence, record.CustomerTier,
		record.Confidence, record.AmountUsd, record.DataSensitivity, record.TrustScore, record.ContextBudget,
		string(decision.RiskLevel), auth.PrincipalID, record.AgentID, record.SessionID, record.ToolIntent, record.PlanSummary, toolParamsJSON, telemetryJSON).Scan(&gatewayDecisionID)
	if err != nil {
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
	_, err = tx.Exec(ctx, `
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
	`, auth.TenantID, auth.WorkspaceID, gatewayDecisionID, record.DecisionID,
		nullableString(hasContext, firstContext.RevisionID), record.ArtifactHash, slaHours, decision.Reason)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
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
