package worker

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// expireLease backdates a lease so a test can exercise the stolen-lease path
// without waiting out leaseTTL. Uses the database's clock, as the lease itself
// does.
func expireLease(t *testing.T, pool *pgxpool.Pool, name string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE job_lease SET expires_at = now() - interval '1 second' WHERE job_name = $1`, name,
	); err != nil {
		t.Fatal(err)
	}
}

func leaseTokenOf(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	var token string
	if err := pool.QueryRow(context.Background(),
		`SELECT token FROM job_lease WHERE job_name = $1`, name).Scan(&token); err != nil {
		t.Fatal(err)
	}
	return token
}

func cleanupLease(t *testing.T, pool *pgxpool.Pool, name string) {
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM job_lease WHERE job_name = $1`, name)
	})
}

func TestJobLeaseIsHeldExclusively(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	first := newLeaseToken()
	acquired, _, err := acquireJobLease(ctx, pool, name, first, nil)
	if err != nil || !acquired {
		t.Fatalf("first acquire: acquired=%v err=%v", acquired, err)
	}

	// A second attempt against a live lease must fail, even from this same
	// process — the guard is the expiry, not the holder.
	again, _, err := acquireJobLease(ctx, pool, name, newLeaseToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if again {
		t.Fatal("a live lease must not be re-acquirable")
	}
}

func TestJobLeaseIsStealableOnlyOnceExpired(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	if acquired, _, err := acquireJobLease(ctx, pool, name, newLeaseToken(), nil); err != nil || !acquired {
		t.Fatalf("setup acquire: %v %v", acquired, err)
	}
	original := leaseTokenOf(t, pool, name)

	expireLease(t, pool, name)

	acquired, _, err := acquireJobLease(ctx, pool, name, newLeaseToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("an expired lease must be stealable, otherwise a crashed holder blocks the job forever")
	}
	if leaseTokenOf(t, pool, name) == original {
		t.Fatal("stealing must install a new token, or the displaced holder could still renew")
	}
}

func TestJobLeaseRenewalExtendsAndIsHolderScoped(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	token := newLeaseToken()
	if acquired, _, err := acquireJobLease(ctx, pool, name, token, nil); err != nil || !acquired {
		t.Fatalf("setup acquire: %v %v", acquired, err)
	}

	var before time.Time
	if err := pool.QueryRow(ctx, `SELECT expires_at FROM job_lease WHERE job_name = $1`, name).Scan(&before); err != nil {
		t.Fatal(err)
	}
	expireLease(t, pool, name)

	held, err := renewJobLease(ctx, pool, name, token)
	if err != nil {
		t.Fatal(err)
	}
	if !held {
		t.Fatal("the holder must be able to renew")
	}
	var after time.Time
	if err := pool.QueryRow(ctx, `SELECT expires_at FROM job_lease WHERE job_name = $1`, name).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !after.After(before.Add(-time.Second)) {
		t.Fatalf("renewal did not extend the lease: %v -> %v", before, after)
	}

	// Simulate the lease having been taken by another process.
	if _, err := pool.Exec(ctx, `UPDATE job_lease SET token = 'someone-else' WHERE job_name = $1`, name); err != nil {
		t.Fatal(err)
	}
	held, err = renewJobLease(ctx, pool, name, token)
	if err != nil {
		t.Fatal(err)
	}
	if held {
		t.Fatal("renewal must report a loss once another process holds the lease")
	}
}

func TestJobLeaseReleaseIsHolderScoped(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	stale := newLeaseToken()
	if acquired, _, err := acquireJobLease(ctx, pool, name, stale, nil); err != nil || !acquired {
		t.Fatalf("setup acquire: %v %v", acquired, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE job_lease SET token = 'someone-else' WHERE job_name = $1`, name); err != nil {
		t.Fatal(err)
	}

	if err := releaseJobLease(ctx, pool, name, stale); err != nil {
		t.Fatal(err)
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_lease WHERE job_name = $1`, name).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("a stale holder must not delete its successor's lease")
	}
}

// The liveness payoff: stealing an expired lease closes the ledger row its dead
// holder left open. This is what job_run could not do on its own.
func TestStealingAnExpiredLeaseClosesItsAbandonedRun(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	// A holder that opened a run and died.
	deadRun := beginJobRun(ctx, pool, slog.Default(), name, TriggerTicker)
	if acquired, _, err := acquireJobLease(ctx, pool, name, newLeaseToken(), &deadRun); err != nil || !acquired {
		t.Fatalf("setup acquire: %v %v", acquired, err)
	}
	expireLease(t, pool, name)

	_, previous, err := acquireJobLease(ctx, pool, name, newLeaseToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if previous == nil || *previous != deadRun {
		t.Fatalf("expected the dead holder's run id back, got %v", previous)
	}
	if err := markRunAbandoned(ctx, pool, *previous); err != nil {
		t.Fatal(err)
	}

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].outcome == nil || *runs[0].outcome != outcomeAbandoned {
		t.Fatalf("outcome = %v, want ABANDONED", runs[0].outcome)
	}
}

// A holder that crashed *after* closing its row must not have that row
// rewritten — its recorded outcome is the truth.
func TestMarkRunAbandonedLeavesAClosedRunAlone(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)

	runID := beginJobRun(ctx, pool, slog.Default(), name, TriggerHTTP)
	finishJobRun(ctx, pool, slog.Default(), runID, time.Now(), errors.New("real failure"))

	if err := markRunAbandoned(ctx, pool, runID); err != nil {
		t.Fatal(err)
	}

	runs := ledgerRunsFor(t, pool, name)
	if runs[0].outcome == nil || *runs[0].outcome != outcomeFailed {
		t.Fatalf("outcome = %v, want FAILED preserved", runs[0].outcome)
	}
}

// End to end: the second caller must not run the sweep at all, and must not
// leave a ledger row for a run that never happened.
func TestRunWithJobLeaseSkipsWhenHeldElsewhere(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	release := make(chan struct{})
	firstRunning := make(chan struct{})
	firstDone := make(chan struct{})

	go func() {
		defer close(firstDone)
		_, _ = runWithJobLease(ctx, pool, slog.Default(), name, TriggerTicker, func(context.Context) error {
			close(firstRunning)
			<-release
			return nil
		})
	}()
	<-firstRunning

	executed := false
	ran, err := runWithJobLease(ctx, pool, slog.Default(), name, TriggerHTTP, func(context.Context) error {
		executed = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if ran {
		t.Fatal("the second caller must not run while the lease is held")
	}
	if executed {
		t.Fatal("the sweep body must not execute without the lease")
	}

	close(release)
	<-firstDone

	runs := ledgerRunsFor(t, pool, name)
	if len(runs) != 1 {
		t.Fatalf("expected exactly one ledger row, got %d — a skipped run must not be recorded", len(runs))
	}
	if runs[0].outcome == nil || *runs[0].outcome != outcomeSuccess {
		t.Fatalf("outcome = %v, want SUCCESS", runs[0].outcome)
	}
}

// The lease is released on completion, so the next tick can take it.
func TestRunWithJobLeaseReleasesOnCompletion(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	if ran, err := runWithJobLease(ctx, pool, slog.Default(), name, TriggerTicker, func(context.Context) error { return nil }); err != nil || !ran {
		t.Fatalf("first run: ran=%v err=%v", ran, err)
	}
	if ran, err := runWithJobLease(ctx, pool, slog.Default(), name, TriggerTicker, func(context.Context) error { return nil }); err != nil || !ran {
		t.Fatalf("second run must acquire after release: ran=%v err=%v", ran, err)
	}
}

// A failing sweep still releases its lease and records the failure; a job that
// errors must not lock itself out.
func TestRunWithJobLeaseReleasesAfterFailure(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	ran, err := runWithJobLease(ctx, pool, slog.Default(), name, TriggerHTTP, func(context.Context) error {
		return errors.New("sweep failed")
	})
	if !ran || err == nil {
		t.Fatalf("expected the run to happen and report failure: ran=%v err=%v", ran, err)
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_lease WHERE job_name = $1`, name).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("a failed sweep must still release its lease")
	}

	runs := ledgerRunsFor(t, pool, name)
	if runs[0].outcome == nil || *runs[0].outcome != outcomeFailed {
		t.Fatalf("outcome = %v, want FAILED", runs[0].outcome)
	}
}

// Regression: the guard must fence one *acquisition*, not one process.
//
// A process identity cannot do it. If a lease expires while its run is still
// alive and the same process reacquires through another trigger — the ticker
// and an external scheduler both hitting one worker — both runs carry the same
// process id. The stale run's renewal would then succeed, so it never learns it
// was displaced and never cancels, and its release would delete the successor's
// lease, admitting a third concurrent run.
func TestADisplacedHolderCannotTouchTheLeaseThatReplacedIt(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	// First acquisition, still running when its lease lapses.
	stale := newLeaseToken()
	if acquired, _, err := acquireJobLease(ctx, pool, name, stale, nil); err != nil || !acquired {
		t.Fatalf("first acquire: %v %v", acquired, err)
	}
	expireLease(t, pool, name)

	// The *same process* reacquires through another trigger.
	successor := newLeaseToken()
	if acquired, _, err := acquireJobLease(ctx, pool, name, successor, nil); err != nil || !acquired {
		t.Fatalf("resteal: %v %v", acquired, err)
	}

	// The displaced run must learn it was displaced, or it never cancels.
	held, err := renewJobLease(ctx, pool, name, stale)
	if err != nil {
		t.Fatal(err)
	}
	if held {
		t.Fatal("a displaced holder must not be able to renew; it would run on alongside its successor")
	}

	// And it must not be able to drop the successor's lease.
	if err := releaseJobLease(ctx, pool, name, stale); err != nil {
		t.Fatal(err)
	}
	if leaseTokenOf(t, pool, name) != successor {
		t.Fatal("a displaced holder released its successor's lease, admitting a third run")
	}

	// Nor open a run under the successor's lease and repoint it.
	runID, held, err := openRunUnderLease(ctx, pool, name, TriggerTicker, stale)
	if err != nil {
		t.Fatal(err)
	}
	if held {
		t.Fatal("a displaced holder must be told it no longer holds the lease")
	}
	if runID != "" {
		t.Fatal("a displaced holder must not open a ledger run")
	}
	var linked *string
	if err := pool.QueryRow(ctx, `SELECT run_id::text FROM job_lease WHERE job_name = $1`, name).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked != nil {
		t.Fatal("a displaced holder overwrote the successor's run id")
	}
}

// Regression: opening the ledger row and linking it to the lease must be one
// transaction.
//
// As two statements, a crash between them leaves an open job_run whose id was
// never written to job_lease — so the successor that steals the expired lease
// gets nothing back and can never close it. The orphan the lease exists to
// clean up would be created by the act of recording it.
func TestOpeningARunAndLinkingItAreAtomic(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	name := uniqueJobName(t)
	cleanupLease(t, pool, name)

	token := newLeaseToken()
	if acquired, _, err := acquireJobLease(ctx, pool, name, token, nil); err != nil || !acquired {
		t.Fatalf("acquire: %v %v", acquired, err)
	}

	runID, held, err := openRunUnderLease(ctx, pool, name, TriggerHTTP, token)
	if err != nil || !held {
		t.Fatalf("open: held=%v err=%v", held, err)
	}
	if runID == "" {
		t.Fatal("expected a run id")
	}

	// The link must be visible the instant the run exists — never one without
	// the other.
	var linked *string
	if err := pool.QueryRow(ctx, `SELECT run_id::text FROM job_lease WHERE job_name = $1`, name).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked == nil || *linked != runID {
		t.Fatalf("lease run_id = %v, want %s recorded atomically with the run", linked, runID)
	}

	// And the recovery path works end to end from that link.
	expireLease(t, pool, name)
	_, previous, err := acquireJobLease(ctx, pool, name, newLeaseToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if previous == nil || *previous != runID {
		t.Fatalf("successor got %v, want the interrupted run %s", previous, runID)
	}
	if err := markRunAbandoned(ctx, pool, *previous); err != nil {
		t.Fatal(err)
	}
	runs := ledgerRunsFor(t, pool, name)
	if runs[0].outcome == nil || *runs[0].outcome != outcomeAbandoned {
		t.Fatalf("outcome = %v, want ABANDONED", runs[0].outcome)
	}
}
