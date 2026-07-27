package worker

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// database-optimizations-audit "What is already good" caveat: the SIEM forwarder
// emitted approverDid as a constant "" because the column does not live on
// runtime_evidence_event. approver_did is an AGT tamper-evidence field on
// agt_verification_result (keyed by artifact hash); listEventsForSiemForwarding
// now sources the most recent approval for the event's artifact. This verifies a
// real DID is forwarded when a verification exists, and "" when it does not.
func TestSiemForwardingPopulatesApproverDid(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()

	withApprover := newGatewayFixture(t, pool)
	withoutApprover := newGatewayFixture(t, pool)

	// Both tenants get a production evidence event old enough to be forwardable
	// (the query excludes rows newer than now() - 5s).
	pastCreatedAt := time.Now().Add(-time.Minute)
	seedA := withApprover.insertRuntimeEvidence(t, "production", pastCreatedAt)
	seedB := withoutApprover.insertRuntimeEvidence(t, "production", pastCreatedAt)

	// Only tenant A has a verification result for the same artifact carrying an
	// approver DID (the fixture inserts evidence with artifact_hash sha256:retention).
	const approverDID = "did:example:approver-siem"
	if _, err := pool.Exec(ctx, `
		INSERT INTO agt_verification_result
			(tenant_id, workspace_id, artifact_hash, verification_type, outcome, run_by, approver_did)
		VALUES ($1, $2, 'sha256:retention', 'AGT_VERIFY', 'PASS', 'tester', $3)
	`, withApprover.tenantID, withApprover.workspaceID, approverDID); err != nil {
		t.Fatalf("insert verification result: %v", err)
	}

	epoch := time.Unix(0, 0)
	const zeroID = "00000000-0000-0000-0000-000000000000"

	evA := findSiemEvent(t, ctx, pool, withApprover.tenantID, withApprover.workspaceID, epoch, zeroID, seedA.decisionID)
	if evA.ApproverDid != approverDID {
		t.Fatalf("approverDid = %q, want %q", evA.ApproverDid, approverDID)
	}

	// No verification result => empty, preserving the prior payload shape.
	evB := findSiemEvent(t, ctx, pool, withoutApprover.tenantID, withoutApprover.workspaceID, epoch, zeroID, seedB.decisionID)
	if evB.ApproverDid != "" {
		t.Fatalf("approverDid = %q, want empty for an event with no verification", evB.ApproverDid)
	}
}

func findSiemEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID, workspaceID string, since time.Time, sinceID, decisionID string) evidenceEvent {
	t.Helper()
	events, err := listEventsForSiemForwarding(ctx, pool, tenantID, workspaceID, since, sinceID, 100)
	if err != nil {
		t.Fatalf("listEventsForSiemForwarding: %v", err)
	}
	for _, e := range events {
		if e.DecisionID == decisionID {
			return e
		}
	}
	t.Fatalf("evidence event %q not returned by the SIEM forwarder", decisionID)
	return evidenceEvent{}
}
