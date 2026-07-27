package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type escalationSLAItem struct {
	ID          string
	TenantID    string
	WorkspaceID string
	DecisionID  string
	Status      string
	AssignedTo  *string
	SLADueAt    time.Time
	RiskLevel   *string
	Reason      *string
}

func runEscalationSLAMonitor(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	rows, err := db.Query(ctx, `
		SELECT
			geq.id::text,
			geq.tenant_id::text,
			geq.workspace_id::text,
			geq.decision_id,
			geq.status,
			geq.assigned_to,
			geq.sla_due_at,
			gd.risk_level,
			gd.reason
		FROM gateway_escalation_queue geq
		JOIN gateway_decision gd ON gd.id = geq.gateway_decision_id
		WHERE geq.status IN ('PENDING', 'IN_REVIEW')
			AND geq.sla_due_at <= now() + interval '30 minutes'
		ORDER BY geq.sla_due_at ASC
		LIMIT 200
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	dueSoon := 0
	overdue := 0
	for rows.Next() {
		var item escalationSLAItem
		if err := rows.Scan(&item.ID, &item.TenantID, &item.WorkspaceID, &item.DecisionID, &item.Status, &item.AssignedTo, &item.SLADueAt, &item.RiskLevel, &item.Reason); err != nil {
			return err
		}
		action := "SLA_DUE_SOON"
		if time.Now().After(item.SLADueAt) {
			action = "SLA_OVERDUE"
			overdue++
		} else {
			dueSoon++
		}
		if err := appendEscalationSLAReminder(ctx, db, item, action); err != nil {
			return err
		}
	}
	if rows.Err() != nil {
		return rows.Err()
	}
	logger.Info("escalation sla monitor complete", "gateway.sla_due_soon", dueSoon, "gateway.sla_overdue", overdue)
	return nil
}

func appendEscalationSLAReminder(ctx context.Context, db *pgxpool.Pool, item escalationSLAItem, action string) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM agt_operations_log
			WHERE tenant_id = $1
				AND source_table = 'gateway_escalation_queue'
				AND source_id = $2
				AND event_type = 'AGENT_TRIAGE'
				AND payload->>'action' = $3
			LIMIT 1
		)
	`, item.TenantID, item.ID, action).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return tx.Commit(ctx)
	}

	if err := appendGenericOperationsLogTx(ctx, tx, item.TenantID, item.WorkspaceID, "AGENT_TRIAGE", item.ID, "gateway_escalation_queue", "agent:sla-monitor-v1", map[string]any{
		"action":     action,
		"queueId":    item.ID,
		"decisionId": item.DecisionID,
		"status":     item.Status,
		"assignedTo": item.AssignedTo,
		"slaDueAt":   item.SLADueAt.UTC().Format(time.RFC3339),
		"riskLevel":  item.RiskLevel,
		"reason":     item.Reason,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
