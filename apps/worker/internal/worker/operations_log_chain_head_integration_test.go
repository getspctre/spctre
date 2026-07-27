package worker

import (
	"context"
	"testing"
)

// Finding 6 (database-optimizations-audit): the worker's operations-log writers
// used to read the tail with an unlocked "ORDER BY created_at DESC LIMIT 1" scan
// and never advanced agt_operations_log_chain_head, so worker appends drifted
// the head stale and forked the chain against the web writer (fixed by 058).
// This proves the shared worker path (appendGenericOperationsLog) now serializes
// and links through the chain-head row: a fresh tenant's first entry links to
// NULL, the head advances to each entry's hash, and the next entry links to the
// previous entry's hash read from the head.
func TestAppendGenericOperationsLogMaintainsChainHead(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	ctx := context.Background()

	sourceA := "chain-a-" + f.suffix
	sourceB := "chain-b-" + f.suffix
	payload := map[string]any{"k": "v"}

	if err := s.appendGenericOperationsLog(ctx, f.tenantID, f.workspaceID, "EVIDENCE_EXPORT", sourceA, "test_table", "actor", payload); err != nil {
		t.Fatalf("append A: %v", err)
	}
	if err := s.appendGenericOperationsLog(ctx, f.tenantID, f.workspaceID, "EVIDENCE_EXPORT", sourceB, "test_table", "actor", payload); err != nil {
		t.Fatalf("append B: %v", err)
	}

	a := f.readOpsLogRow(t, sourceA)
	b := f.readOpsLogRow(t, sourceB)

	// First entry for a fresh tenant has no predecessor.
	if a.prevHash != nil {
		t.Fatalf("first entry prev_hash = %q, want NULL", *a.prevHash)
	}
	// Second entry links to the first via the chain head, not a tail scan.
	if b.prevHash == nil {
		t.Fatalf("second entry prev_hash = NULL, want first content_hash %q", a.contentHash)
	}
	if *b.prevHash != a.contentHash {
		t.Fatalf("second entry prev_hash = %q, want first content_hash %q", *b.prevHash, a.contentHash)
	}
	// The chain head points at the latest entry.
	var headHash *string
	if err := pool.QueryRow(ctx,
		`SELECT last_hash FROM agt_operations_log_chain_head WHERE tenant_id = $1`, f.tenantID,
	).Scan(&headHash); err != nil {
		t.Fatalf("read chain head: %v", err)
	}
	if headHash == nil || *headHash != b.contentHash {
		t.Fatalf("chain head last_hash = %v, want second content_hash %q", headHash, b.contentHash)
	}
}

type opsLogRow struct {
	contentHash string
	prevHash    *string
}

func (f gatewayFixture) readOpsLogRow(t *testing.T, sourceID string) opsLogRow {
	t.Helper()
	var row opsLogRow
	if err := f.pool.QueryRow(context.Background(),
		`SELECT content_hash, prev_hash FROM agt_operations_log WHERE tenant_id = $1 AND source_id = $2`,
		f.tenantID, sourceID,
	).Scan(&row.contentHash, &row.prevHash); err != nil {
		t.Fatalf("read ops log row %q: %v", sourceID, err)
	}
	return row
}
