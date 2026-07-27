package worker

import (
	"context"
	"testing"
	"time"
)

func TestAppendEscalationSLAReminderIsActionIdempotent(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()

	decisionID := "dec-sla-" + f.suffix
	gatewayDecisionID := f.insertDecision(t, decisionID)
	queueID := f.insertEscalationQueue(t, gatewayDecisionID, decisionID, "IN_REVIEW", time.Now().Add(-10*time.Minute))
	assignedTo := "reviewer-1"
	riskLevel := "HIGH"
	reason := "policy requires human review"
	item := escalationSLAItem{
		ID:          queueID,
		TenantID:    f.tenantID,
		WorkspaceID: f.workspaceID,
		DecisionID:  decisionID,
		Status:      "IN_REVIEW",
		AssignedTo:  &assignedTo,
		SLADueAt:    time.Now().Add(-10 * time.Minute).UTC(),
		RiskLevel:   &riskLevel,
		Reason:      &reason,
	}

	if err := appendEscalationSLAReminder(ctx, pool, item, "SLA_DUE_SOON"); err != nil {
		t.Fatal(err)
	}
	if err := appendEscalationSLAReminder(ctx, pool, item, "SLA_DUE_SOON"); err != nil {
		t.Fatal(err)
	}
	if got := f.escalationSLAReminderCount(t, queueID, "SLA_DUE_SOON"); got != 1 {
		t.Fatalf("SLA_DUE_SOON reminders = %d, want 1", got)
	}

	if err := appendEscalationSLAReminder(ctx, pool, item, "SLA_OVERDUE"); err != nil {
		t.Fatal(err)
	}
	if err := appendEscalationSLAReminder(ctx, pool, item, "SLA_OVERDUE"); err != nil {
		t.Fatal(err)
	}
	if got := f.escalationSLAReminderCount(t, queueID, "SLA_OVERDUE"); got != 1 {
		t.Fatalf("SLA_OVERDUE reminders = %d, want 1", got)
	}
	if got := f.escalationSLAReminderCount(t, queueID, ""); got != 2 {
		t.Fatalf("total SLA reminders = %d, want 2", got)
	}

	var payloadDecisionID, payloadAssignedTo string
	if err := pool.QueryRow(ctx, `
		SELECT payload->>'decisionId', payload->>'assignedTo'
		FROM agt_operations_log
		WHERE tenant_id = $1
		  AND source_table = 'gateway_escalation_queue'
		  AND source_id = $2
		  AND event_type = 'AGENT_TRIAGE'
		  AND payload->>'action' = 'SLA_DUE_SOON'
	`, f.tenantID, queueID).Scan(&payloadDecisionID, &payloadAssignedTo); err != nil {
		t.Fatalf("read SLA reminder payload: %v", err)
	}
	if payloadDecisionID != decisionID {
		t.Fatalf("payload decisionId = %q, want %q", payloadDecisionID, decisionID)
	}
	if payloadAssignedTo != assignedTo {
		t.Fatalf("payload assignedTo = %q, want %q", payloadAssignedTo, assignedTo)
	}
}

func (f gatewayFixture) insertEscalationQueue(t *testing.T, gatewayDecisionID, decisionID, status string, slaDueAt time.Time) string {
	t.Helper()
	var queueID string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO gateway_escalation_queue (
			tenant_id,
			workspace_id,
			gateway_decision_id,
			decision_id,
			artifact_hash,
			status,
			sla_due_at,
			handoff_notes
		) VALUES ($1, $2, $3, $4, 'sha256:itest', $5, $6, 'integration test')
		RETURNING id::text
	`, f.tenantID, f.workspaceID, gatewayDecisionID, decisionID, status, slaDueAt).Scan(&queueID); err != nil {
		t.Fatalf("insert escalation queue: %v", err)
	}
	return queueID
}

func (f gatewayFixture) escalationSLAReminderCount(t *testing.T, queueID string, action string) int {
	t.Helper()
	query := `
		SELECT count(*)
		FROM agt_operations_log
		WHERE tenant_id = $1
		  AND source_table = 'gateway_escalation_queue'
		  AND source_id = $2
		  AND event_type = 'AGENT_TRIAGE'
	`
	args := []any{f.tenantID, queueID}
	if action != "" {
		query += ` AND payload->>'action' = $3`
		args = append(args, action)
	}
	var n int
	if err := f.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count SLA reminders: %v", err)
	}
	return n
}
