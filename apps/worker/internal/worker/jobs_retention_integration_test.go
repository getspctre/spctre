package worker

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestBatchedPruneEvidenceDeletesMatchingRowsAndKeys(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	target := newGatewayFixture(t, pool)
	other := newGatewayFixture(t, pool)

	old := time.Now().Add(-72 * time.Hour).UTC()
	recent := time.Now().Add(-1 * time.Hour).UTC()

	targetExpired := target.insertRuntimeEvidence(t, "staging", old)
	targetProduction := target.insertRuntimeEvidence(t, "production", old.Add(time.Minute))
	targetRecent := target.insertRuntimeEvidence(t, "staging", recent)
	otherExpired := other.insertRuntimeEvidence(t, "staging", old.Add(2*time.Minute))

	pruned, err := batchedPruneEvidence(ctx, pool,
		`tenant_id = $1 AND environment = 'staging' AND created_at < now() - interval '2 days'`,
		target.tenantID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if pruned != 1 {
		t.Fatalf("expected exactly one pruned row, got %d", pruned)
	}

	target.assertEvidenceMissing(t, targetExpired.decisionID)
	target.assertEvidenceKeyMissing(t, targetExpired.decisionID)
	target.assertEvidencePresent(t, targetProduction.decisionID)
	target.assertEvidenceKeyPresent(t, targetProduction.decisionID)
	target.assertEvidencePresent(t, targetRecent.decisionID)
	target.assertEvidenceKeyPresent(t, targetRecent.decisionID)
	other.assertEvidencePresent(t, otherExpired.decisionID)
	other.assertEvidenceKeyPresent(t, otherExpired.decisionID)
}

type runtimeEvidenceSeed struct {
	decisionID string
}

func (f gatewayFixture) insertRuntimeEvidence(t *testing.T, environment string, createdAt time.Time) runtimeEvidenceSeed {
	t.Helper()
	decisionID := fmt.Sprintf("retention-%s-%d", environment, createdAt.UnixNano())
	var eventID string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO runtime_evidence_event (
			decision_id,
			tenant_id,
			workspace_id,
			environment,
			runtime_stack,
			agent_id,
			connector,
			action,
			status,
			reason,
			policy_refs,
			artifact_hash,
			policy_context,
			raw_evidence,
			created_at,
			evidence_content_hash
		) VALUES (
			$1, $2, $3, $4, 'CUSTOM', 'retention-agent', 'github', 'push',
			'DENY', 'retention test', ARRAY['policy-retention'],
			'sha256:retention', '{}'::jsonb, '{}'::jsonb, $5, $6
		)
		RETURNING id::text
	`, decisionID, f.tenantID, f.workspaceID, environment, createdAt, "sha256:"+decisionID).Scan(&eventID); err != nil {
		t.Fatalf("insert runtime evidence: %v", err)
	}

	if _, err := f.pool.Exec(context.Background(), `
		INSERT INTO runtime_evidence_event_key (
			tenant_id,
			decision_id,
			evidence_event_id,
			evidence_created_at,
			created_at
		) VALUES ($1, $2, $3, $4, $4)
	`, f.tenantID, decisionID, eventID, createdAt); err != nil {
		t.Fatalf("insert runtime evidence key: %v", err)
	}

	return runtimeEvidenceSeed{decisionID: decisionID}
}

func (f gatewayFixture) assertEvidencePresent(t *testing.T, decisionID string) {
	t.Helper()
	if !f.evidenceExists(t, "runtime_evidence_event", decisionID) {
		t.Fatalf("expected runtime_evidence_event %q to remain", decisionID)
	}
}

func (f gatewayFixture) assertEvidenceMissing(t *testing.T, decisionID string) {
	t.Helper()
	if f.evidenceExists(t, "runtime_evidence_event", decisionID) {
		t.Fatalf("expected runtime_evidence_event %q to be pruned", decisionID)
	}
}

func (f gatewayFixture) assertEvidenceKeyPresent(t *testing.T, decisionID string) {
	t.Helper()
	if !f.evidenceExists(t, "runtime_evidence_event_key", decisionID) {
		t.Fatalf("expected runtime_evidence_event_key %q to remain", decisionID)
	}
}

func (f gatewayFixture) assertEvidenceKeyMissing(t *testing.T, decisionID string) {
	t.Helper()
	if f.evidenceExists(t, "runtime_evidence_event_key", decisionID) {
		t.Fatalf("expected runtime_evidence_event_key %q to be pruned", decisionID)
	}
}

func (f gatewayFixture) evidenceExists(t *testing.T, table string, decisionID string) bool {
	t.Helper()
	var exists bool
	if err := f.pool.QueryRow(context.Background(), fmt.Sprintf(
		`SELECT EXISTS (SELECT 1 FROM %s WHERE tenant_id = $1 AND decision_id = $2)`,
		table,
	), f.tenantID, decisionID).Scan(&exists); err != nil {
		t.Fatalf("check %s row: %v", table, err)
	}
	return exists
}
