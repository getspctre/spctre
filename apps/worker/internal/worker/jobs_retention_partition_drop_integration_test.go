package worker

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Finding 3 (database-optimizations-audit), structural variant:
// dropEmptyExpiredEvidencePartitions reclaims whole monthly partitions once they
// are fully in the past AND empty, but must never drop a past partition that
// still holds rows (it may contain un-archived or still-retained evidence).
func TestDropEmptyExpiredEvidencePartitions(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	const emptyPart = "runtime_evidence_event_2020_01"
	const fullPart = "runtime_evidence_event_2020_02"

	// Fresh historical partitions (drop any leftovers from a prior run first).
	for _, spec := range []struct{ name, from, to string }{
		{emptyPart, "2020-01-01", "2020-02-01"},
		{fullPart, "2020-02-01", "2020-03-01"},
	} {
		if _, err := pool.Exec(ctx, "DROP TABLE IF EXISTS "+spec.name); err != nil {
			t.Fatalf("drop leftover %s: %v", spec.name, err)
		}
		if _, err := pool.Exec(ctx,
			"CREATE TABLE "+spec.name+" PARTITION OF runtime_evidence_event FOR VALUES FROM ('"+spec.from+"') TO ('"+spec.to+"')",
		); err != nil {
			t.Fatalf("create %s: %v", spec.name, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DROP TABLE IF EXISTS "+emptyPart)
		_, _ = pool.Exec(context.Background(), "DROP TABLE IF EXISTS "+fullPart)
	})

	// Put one row in the fully-past "full" partition; leave the other empty.
	f.insertRuntimeEvidence(t, "production", time.Date(2020, 2, 15, 0, 0, 0, 0, time.UTC))

	if err := dropEmptyExpiredEvidencePartitions(ctx, pool, logger); err != nil {
		t.Fatalf("dropEmptyExpiredEvidencePartitions: %v", err)
	}

	if partitionExists(t, pool, emptyPart) {
		t.Fatalf("expected empty past partition %q to be dropped", emptyPart)
	}
	if !partitionExists(t, pool, fullPart) {
		t.Fatalf("expected non-empty past partition %q to be retained", fullPart)
	}
}

func partitionExists(t *testing.T, pool *pgxpool.Pool, name string) bool {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = $1)`, name,
	).Scan(&exists); err != nil {
		t.Fatalf("check partition %q: %v", name, err)
	}
	return exists
}
