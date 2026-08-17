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

// The orphan case: a process that dies mid-sweep leaves an open row, and the
// next run of the same job is what closes it. This is the whole reason there is
// no reaper.
func TestJobLedgerClosesAnOrphanedRunOnTheNextStart(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	orphan := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	if orphan == "" {
		t.Fatal("expected a run id")
	}
	// No finishJobRun: simulates the process dying mid-sweep.

	second := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	finishJobRun(ctx, pool, slog.Default(), second, time.Now(), nil)

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if runs[0].outcome == nil || *runs[0].outcome != outcomeAbandoned {
		t.Fatalf("orphan outcome = %v, want ABANDONED", runs[0].outcome)
	}
	if !runs[0].finished {
		t.Fatal("expected the orphan to be closed")
	}
	// ABANDONED stays distinct from FAILED: "we do not know how it ended" is
	// not the same claim as "it returned an error".
	if runs[1].outcome == nil || *runs[1].outcome != outcomeSuccess {
		t.Fatalf("second outcome = %v, want SUCCESS", runs[1].outcome)
	}
	if runs[1].errText != nil {
		t.Fatalf("abandoning an earlier run must not attach an error to the new one, got %q", *runs[1].errText)
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
