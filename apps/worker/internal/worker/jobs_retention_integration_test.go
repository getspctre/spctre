package worker

import (
	"context"
	"fmt"
	"log/slog"
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

func TestPruneOrphanedPolicyContentArtifactsRetainsEvidenceAndVerificationReferences(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	fixture := newGatewayFixture(t, pool)

	expired := fixture.insertRuntimeEvidence(t, "staging", time.Now().Add(-72*time.Hour).UTC())
	retained := fixture.insertRuntimeEvidence(t, "staging", time.Now().Add(-time.Hour).UTC())
	expiredHash := "sha256:" + fmt.Sprintf("%064x", 1)
	retainedHash := "sha256:" + fmt.Sprintf("%064x", 2)
	verifiedHash := "sha256:" + fmt.Sprintf("%064x", 3)
	for _, hash := range []string{expiredHash, retainedHash, verifiedHash} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO policy_content_artifact (content_hash, media_type, size_bytes, content_encrypted)
			VALUES ($1, 'application/yaml', 1, '\\x01'::bytea)
		`, hash); err != nil {
			t.Fatalf("insert policy artifact: %v", err)
		}
	}
	for _, item := range []struct{ decisionID, hash string }{
		{expired.decisionID, expiredHash},
		{retained.decisionID, retainedHash},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO runtime_evidence_policy_content_ref
				(tenant_id, workspace_id, decision_id, content_hash)
			VALUES ($1, $2, $3, $4)
		`, fixture.tenantID, fixture.workspaceID, item.decisionID, item.hash); err != nil {
			t.Fatalf("bind policy artifact: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO agt_verification_result
			(tenant_id, workspace_id, artifact_hash, policy_content_hash, verification_type, outcome, summary, run_by)
		VALUES ($1, $2, 'sha256:semantic', $3, 'AGT_VERIFY_EVIDENCE', 'PASS', '{}'::jsonb, 'retention-test')
	`, fixture.tenantID, fixture.workspaceID, verifiedHash); err != nil {
		t.Fatalf("insert verification reference: %v", err)
	}

	if _, err := batchedPruneEvidence(ctx, pool,
		`tenant_id = $1 AND environment = 'staging' AND created_at < now() - interval '2 days'`, fixture.tenantID); err != nil {
		t.Fatal(err)
	}
	if err := pruneOrphanedPolicyContentArtifacts(ctx, pool, slog.Default()); err != nil {
		t.Fatal(err)
	}

	for _, assertion := range []struct {
		hash string
		want bool
	}{
		{expiredHash, false},
		{retainedHash, true},
		{verifiedHash, true},
	} {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM policy_content_artifact WHERE content_hash = $1)`, assertion.hash).Scan(&exists); err != nil {
			t.Fatalf("check artifact %s: %v", assertion.hash, err)
		}
		if exists != assertion.want {
			t.Errorf("artifact %s exists = %t, want %t", assertion.hash, exists, assertion.want)
		}
	}
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
