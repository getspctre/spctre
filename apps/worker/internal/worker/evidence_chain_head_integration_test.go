package worker

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// Finding 2 (database-optimizations-audit), structural variant: the
// runtime-evidence hash chain is serialized and read through the per-tenant
// runtime_evidence_chain_head row (upsert row lock + last_hash) instead of an
// advisory lock plus a partition-wide tail scan. This proves the worker's
// insertEvidence maintains that chain end to end: the first event for a fresh
// tenant links to NULL, the head advances to each event's content hash, and the
// next event links to the previous event's hash read from the head row.
func TestInsertEvidenceMaintainsChainHead(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)

	first := s.mustInsertChainEvidence(t, f, "chain-1")
	second := s.mustInsertChainEvidence(t, f, "chain-2")

	// First event of a fresh tenant has no predecessor.
	if first.prevHash != nil {
		t.Fatalf("first event prev_hash = %q, want NULL", *first.prevHash)
	}
	// Second event links to the first via the chain head, not a tail scan.
	if second.prevHash == nil {
		t.Fatalf("second event prev_hash = NULL, want first content_hash %q", first.contentHash)
	}
	if *second.prevHash != first.contentHash {
		t.Fatalf("second event prev_hash = %q, want first content_hash %q", *second.prevHash, first.contentHash)
	}
	// The chain head points at the latest event.
	var headHash *string
	if err := pool.QueryRow(context.Background(),
		`SELECT last_hash FROM runtime_evidence_chain_head WHERE tenant_id = $1`, f.tenantID,
	).Scan(&headHash); err != nil {
		t.Fatalf("read chain head: %v", err)
	}
	if headHash == nil {
		t.Fatalf("chain head last_hash = NULL, want second content_hash %q", second.contentHash)
	}
	if *headHash != second.contentHash {
		t.Fatalf("chain head last_hash = %q, want second content_hash %q", *headHash, second.contentHash)
	}
}

type chainEvidence struct {
	decisionID  string
	contentHash string
	prevHash    *string
}

func (s *Server) mustInsertChainEvidence(t *testing.T, f gatewayFixture, prefix string) chainEvidence {
	t.Helper()
	decisionID := fmt.Sprintf("%s-%s", prefix, f.suffix)
	latency := 100
	inserted, err := s.insertEvidence(context.Background(), EvidenceRequest{
		DecisionID:    decisionID,
		TenantID:      f.tenantID,
		WorkspaceID:   f.workspaceID,
		Environment:   "production",
		RuntimeTarget: RuntimeTarget{Stack: RuntimeStack("CUSTOM")},
		AgentID:       "chain-agent",
		Connector:     "github",
		Action:        "push",
		Status:        "ALLOW",
		Reason:        "chain test",
		PolicyRefs:    []string{"policy-chain"},
		ArtifactHash:  "sha256:art-" + decisionID,
		PolicyContext: []RuntimePolicyContext{},
		LatencyMS:     &latency,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		RawEvidence:   map[string]any{"decision": decisionID},
	})
	if err != nil {
		t.Fatalf("insertEvidence(%s): %v", decisionID, err)
	}
	if !inserted {
		t.Fatalf("insertEvidence(%s): inserted=false, want true", decisionID)
	}

	ev := chainEvidence{decisionID: decisionID}
	if err := f.pool.QueryRow(context.Background(),
		`SELECT evidence_content_hash, evidence_prev_hash
		 FROM runtime_evidence_event WHERE tenant_id = $1 AND decision_id = $2`,
		f.tenantID, decisionID,
	).Scan(&ev.contentHash, &ev.prevHash); err != nil {
		t.Fatalf("read event %s: %v", decisionID, err)
	}
	return ev
}
