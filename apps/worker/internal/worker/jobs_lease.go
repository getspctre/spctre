package worker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// leaseTTL bounds how long a lease survives without renewal. Recovery after
	// a crash costs at most this much, so a five-minute sweep loses one tick.
	leaseTTL = 90 * time.Second
	// leaseRenewInterval must divide leaseTTL with room to spare: three
	// consecutive renewals have to fail before a live holder looks dead.
	leaseRenewInterval = 30 * time.Second
)

// leaseHolder identifies this process. Generated once at startup: a restarted
// process is a different holder, which is correct, because it cannot renew the
// lease its predecessor was holding.
var leaseHolder = func() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		// Only the pid then. Weaker as an identity, but the holder guard still
		// works within a host, and a failing CSPRNG is not worth aborting for.
		return fmt.Sprintf("pid-%d", os.Getpid())
	}
	return fmt.Sprintf("%s-%d", hex.EncodeToString(buf), os.Getpid())
}()

// acquireJobLease takes the lease for a job, or reports that someone else holds
// it. The second return is the run_id recorded by an expired holder, if this
// call stole one — the ledger row that holder left open.
//
// One statement, so two callers cannot both win. The WHERE on the conflict
// clause is the safety property: a live lease is not stolen, the update is
// skipped, and zero rows come back.
func acquireJobLease(ctx context.Context, db *pgxpool.Pool, name string, runID *string) (bool, *string, error) {
	if db == nil {
		// No database means no coordination is possible. Callers run anyway:
		// refusing would make an unconfigured worker silently do nothing, and
		// a deployment with no database has no concurrent peer to race.
		return true, nil, nil
	}

	// A CTE rather than RETURNING: RETURNING sees the row after the upsert, so
	// it would hand back the run_id being written rather than the dead holder's.
	// The prev branch reads the pre-statement snapshot, which is the value
	// wanted — and it is only trusted when acquired is true, so a racing writer
	// making it stale does not matter.
	var acquired bool
	var previous *string
	if err := db.QueryRow(ctx, `
		WITH prev AS (
			SELECT run_id FROM job_lease WHERE job_name = $1
		),
		upserted AS (
			INSERT INTO job_lease (job_name, holder, expires_at, run_id)
			VALUES ($1, $2, now() + $3::interval, $4::uuid)
			ON CONFLICT (job_name) DO UPDATE
			   SET holder      = EXCLUDED.holder,
			       acquired_at = now(),
			       renewed_at  = now(),
			       expires_at  = EXCLUDED.expires_at,
			       run_id      = EXCLUDED.run_id
			 WHERE job_lease.expires_at < now()
			RETURNING job_name
		)
		SELECT EXISTS (SELECT 1 FROM upserted),
		       (SELECT run_id::text FROM prev)
	`, name, leaseHolder, leaseTTL.String(), runID).Scan(&acquired, &previous); err != nil {
		return false, nil, err
	}
	if !acquired {
		return false, nil, nil
	}
	return true, previous, nil
}

// setJobLeaseRun records which ledger row this lease covers. Separate from
// acquisition because re-running the upsert would meet its own guard: the lease
// is live by then, so the WHERE would skip the update and report a loss.
func setJobLeaseRun(ctx context.Context, db *pgxpool.Pool, name, runID string) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(ctx,
		`UPDATE job_lease SET run_id = $3::uuid WHERE job_name = $1 AND holder = $2`,
		name, leaseHolder, runID)
	return err
}

// renewJobLease extends the lease. Reports false when this process is no longer
// the holder — the lease expired and another worker took it.
func renewJobLease(ctx context.Context, db *pgxpool.Pool, name string) (bool, error) {
	if db == nil {
		return true, nil
	}
	tag, err := db.Exec(ctx, `
		UPDATE job_lease
		   SET renewed_at = now(), expires_at = now() + $3::interval
		 WHERE job_name = $1 AND holder = $2
	`, name, leaseHolder, leaseTTL.String())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// releaseJobLease drops the lease. Scoped to the holder so a slow run that
// already lost its lease cannot delete its successor's.
func releaseJobLease(ctx context.Context, db *pgxpool.Pool, name string) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(ctx,
		`DELETE FROM job_lease WHERE job_name = $1 AND holder = $2`, name, leaseHolder)
	return err
}

// markRunAbandoned closes a ledger row left open by a dead holder.
//
// Safe only because the caller holds the lease, so there is no competing
// writer. Guarded on finished_at IS NULL so a holder that crashed after closing
// its row is not rewritten.
func markRunAbandoned(ctx context.Context, db *pgxpool.Pool, runID string) error {
	_, err := db.Exec(ctx, `
		UPDATE job_run
		   SET finished_at = now(), outcome = $2
		 WHERE id = $1::uuid AND finished_at IS NULL
	`, runID, outcomeAbandoned)
	return err
}

// leaseKeeper renews a held lease until the run finishes, and cancels the run
// if the lease is lost.
type leaseKeeper struct {
	cancel context.CancelFunc
	done   chan struct{}
	stop   sync.Once
}

// startLeaseKeeper renews name's lease every leaseRenewInterval. If a renewal
// reports that the lease is gone, it cancels ctx.
//
// Cancelling matters: a lost lease means another worker has taken the job and
// may already be running it, which is the state this whole mechanism exists to
// prevent. Self-cancelling bounds the overlap to one renewal interval instead
// of one sweep duration.
//
// It does not fence: a write already in flight when the lease is lost still
// lands. Full fencing would thread a lease generation through every write,
// which is disproportionate when the worst case here is a duplicate message.
func startLeaseKeeper(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, name string, cancel context.CancelFunc) *leaseKeeper {
	k := &leaseKeeper{cancel: cancel, done: make(chan struct{})}
	go func() {
		ticker := time.NewTicker(leaseRenewInterval)
		defer ticker.Stop()
		for {
			select {
			case <-k.done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				held, err := renewJobLease(ctx, db, name)
				if err != nil {
					// Transient: the TTL allows three consecutive failures
					// before the lease lapses, so keep working.
					logger.Warn("job lease: renewal failed", "worker.job.name", name, "error", err)
					continue
				}
				if !held {
					logger.Error("job lease lost mid-run; cancelling",
						"worker.job.name", name,
						"detail", "another worker holds this job's lease, so continuing would run it twice")
					k.cancel()
					return
				}
			}
		}
	}()
	return k
}

// Stop ends renewal. Safe to call more than once.
func (k *leaseKeeper) Stop() {
	k.stop.Do(func() { close(k.done) })
}

// runWithJobLease is the single entry point both trigger paths use, so
// exclusion no longer depends on which one a deployment happens to run.
//
// Ordering is deliberate. The lease is taken before the ledger row is opened,
// so a run that is not happening leaves no record; and it is released last, so
// a crash anywhere leaves a lease that expires, which is what makes the
// predecessor's state recoverable.
//
// Reports false when the lease was held elsewhere and the sweep did not run.
func runWithJobLease(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, name, trigger string, fn func(context.Context) error) (bool, error) {
	acquired, previousRun, err := acquireJobLease(ctx, db, name, nil)
	if err != nil {
		// Without coordination, running risks the duplicate side effects this
		// exists to prevent — and a sweep that cannot reach the database has
		// nothing to do anyway.
		return false, fmt.Errorf("acquiring job lease: %w", err)
	}
	if !acquired {
		return false, nil
	}

	// Close whatever the dead holder left open. Best-effort: failing to tidy
	// history must not stop the sweep.
	if previousRun != nil && *previousRun != "" {
		if err := markRunAbandoned(ctx, db, *previousRun); err != nil {
			logger.Warn("job lease: failed to close abandoned run", "worker.job.name", name, "worker.job.run_id", *previousRun, "error", err)
		}
	}

	started := time.Now()
	runID := beginJobRun(ctx, db, logger, name, trigger)
	if runID != "" {
		if err := setJobLeaseRun(ctx, db, name, runID); err != nil {
			logger.Warn("job lease: failed to record run id", "worker.job.name", name, "error", err)
		}
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	keeper := startLeaseKeeper(runCtx, db, logger, name, cancel)

	runErr := fn(runCtx)

	keeper.Stop()
	finishJobRun(ctx, db, logger, runID, started, runErr)
	if err := releaseJobLease(ctx, db, name); err != nil {
		logger.Warn("job lease: release failed", "worker.job.name", name, "error", err)
	}
	return true, runErr
}
