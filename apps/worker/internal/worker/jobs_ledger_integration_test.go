package worker

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type ledgerRow struct {
	trigger    string
	outcome    *string
	errText    *string
	durationMs *int
	finished   bool
}

func ledgerRunsFor(t *testing.T, pool *pgxpool.Pool, name string) []ledgerRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT trigger, outcome, error, duration_ms, finished_at IS NOT NULL
		  FROM job_run WHERE job_name = $1 ORDER BY started_at
	`, name)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	var out []ledgerRow
	for rows.Next() {
		var r ledgerRow
		if err := rows.Scan(&r.trigger, &r.outcome, &r.errText, &r.durationMs, &r.finished); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// uniqueJobName keeps each test's rows isolated without truncating a shared
// table, so these can run alongside the rest of the suite.
func uniqueJobName(t *testing.T) string {
	t.Helper()
	return "test-" + t.Name() + "-" + time.Now().Format("150405.000000")
}

func TestJobLedgerRecordsASuccessfulRun(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	started := time.Now()
	id := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	if id == "" {
		t.Fatal("expected a run id")
	}
	finishJobRun(ctx, pool, slog.Default(), id, started, nil)

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].trigger != TriggerHTTP {
		t.Fatalf("trigger = %q, want %q", runs[0].trigger, TriggerHTTP)
	}
	if runs[0].outcome == nil || *runs[0].outcome != outcomeSuccess {
		t.Fatalf("outcome = %v, want SUCCESS", runs[0].outcome)
	}
	if runs[0].errText != nil {
		t.Fatalf("expected no error text, got %q", *runs[0].errText)
	}
	if runs[0].durationMs == nil {
		t.Fatal("expected a duration")
	}
}

func TestJobLedgerRecordsAFailureWithItsError(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	id := beginJobRun(ctx, pool, slog.Default(), name, TriggerTicker)
	finishJobRun(ctx, pool, slog.Default(), id, time.Now(), errors.New("sweep exploded"))

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].outcome == nil || *runs[0].outcome != outcomeFailed {
		t.Fatalf("outcome = %v, want FAILED", runs[0].outcome)
	}
	if runs[0].errText == nil || *runs[0].errText != "sweep exploded" {
		t.Fatalf("error = %v, want %q", runs[0].errText, "sweep exploded")
	}
	if runs[0].trigger != TriggerTicker {
		t.Fatalf("trigger = %q, want %q", runs[0].trigger, TriggerTicker)
	}
}

// Regression: starting a run must never close another open run of the same job.
//
// Only the HTTP job endpoints take the per-job advisory lock; the in-process
// ticker takes none. Two runs of one job can therefore overlap — between
// replicas, or between the ticker and an external scheduler — and closing on
// start would stamp a live run as ABANDONED, corrupting the signal this table
// exists to provide. An interrupted run stays open instead.
func TestJobLedgerStartDoesNotCloseAConcurrentRun(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	// Still running: the ticker holds no lock, so this genuinely can be live.
	inFlight := beginJobRun(ctx, pool, slog.Default(), name, TriggerTicker)
	if inFlight == "" {
		t.Fatal("expected a run id")
	}

	// A second trigger arrives while the first is working.
	second := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	finishJobRun(ctx, pool, slog.Default(), second, time.Now(), nil)

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if runs[0].finished {
		t.Fatal("a live run must not be closed by a concurrent start")
	}
	if runs[0].outcome != nil {
		t.Fatalf("live run outcome = %q, want none", *runs[0].outcome)
	}
	if runs[1].outcome == nil || *runs[1].outcome != outcomeSuccess {
		t.Fatalf("second outcome = %v, want SUCCESS", runs[1].outcome)
	}

	// The first run finishing afterwards still records its own outcome.
	finishJobRun(ctx, pool, slog.Default(), inFlight, time.Now(), nil)
	runs = ledgerRunsFor(t, pool, name)
	if runs[0].outcome == nil || *runs[0].outcome != outcomeSuccess {
		t.Fatalf("first run outcome = %v after finishing, want SUCCESS", runs[0].outcome)
	}
}

// A process that dies mid-sweep leaves its row open, and nothing closes it.
// That is deliberate: "started, never finished" is the truth, where guessing
// would risk mislabelling a run that is merely slow.
func TestJobLedgerLeavesAnInterruptedRunOpen(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP) // never finished
	next := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	finishJobRun(ctx, pool, slog.Default(), next, time.Now(), nil)

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if runs[0].finished {
		t.Fatal("an interrupted run stays open until a liveness-based sweep closes it")
	}
}

// A run in flight must stay open — closing it eagerly would make "currently
// running" indistinguishable from "finished".
func TestJobLedgerLeavesAnInFlightRunOpen(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].finished {
		t.Fatal("expected the run to still be open")
	}
	if runs[0].outcome != nil {
		t.Fatalf("expected no outcome while in flight, got %q", *runs[0].outcome)
	}
}

// The ledger observes sweeps; it must never be the reason one fails. A blank
// id (the signal that the open failed) has to be safe to close.
func TestJobLedgerFinishIsSafeWithoutAnOpenRun(t *testing.T) {
	pool := testGatewayDB(t)
	finishJobRun(context.Background(), pool, slog.Default(), "", time.Now(), nil)
	finishJobRun(context.Background(), nil, slog.Default(), "some-id", time.Now(), nil)
	if id := beginJobRun(context.Background(), nil, slog.Default(), "x", TriggerHTTP); id != "" {
		t.Fatalf("expected no id without a database, got %q", id)
	}
}

func TestPruneJobRunsDropsOnlyRunsPastTheWindow(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	var oldID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO job_run (job_name, trigger, started_at, finished_at, outcome)
		VALUES ($1, 'HTTP', now() - interval '45 days', now() - interval '45 days', 'SUCCESS')
		RETURNING id::text
	`, name).Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	recent := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	finishJobRun(ctx, pool, slog.Default(), recent, time.Now(), nil)

	if _, err := pruneJobRuns(ctx, pool); err != nil {
		t.Fatal(err)
	}

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 1 {
		t.Fatalf("expected only the recent run to survive, got %d", len(runs))
	}
}
