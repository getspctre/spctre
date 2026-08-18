package worker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
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

// leaseHolder names this process. Diagnostic only — never a guard.
//
// It cannot fence: if a lease expires while its run is still alive and the same
// process reacquires through another trigger, both runs share this value, so
// the stale run would renew successfully, never learn it was displaced, and
// release the successor's lease. newLeaseToken is the identity that guards.
var leaseHolder = func() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		// Only the pid then. Weaker as an identity, but the holder guard still
		// works within a host, and a failing CSPRNG is not worth aborting for.
		return fmt.Sprintf("pid-%d", os.Getpid())
	}
	return fmt.Sprintf("%s-%d", hex.EncodeToString(buf), os.Getpid())
}()

// newLeaseToken mints the fencing identity for one acquisition. Unique per
// acquisition, so a displaced holder can neither renew nor release the lease
// that replaced it.
func newLeaseToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// Fall back to something still unique per acquisition rather than
		// reusing a process-wide value, which is the failure this guards.
		return fmt.Sprintf("t-%d-%d", os.Getpid(), time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

// acquireJobLease takes the lease for a job, or reports that someone else holds
// it. The second return is the ledger row this call closed as ABANDONED, if it
// stole the lease from a holder that died mid-run — reported for logging, since
// the close has already happened.
//
// One statement, so two callers cannot both win. The WHERE on the conflict
// clause is the safety property: a live lease is not stolen, the update is
// skipped, and zero rows come back.
func acquireJobLease(ctx context.Context, db *pgxpool.Pool, name, token string, runID *string) (bool, *string, error) {
	if db == nil {
		// No database means no coordination is possible. Callers run anyway:
		// refusing would make an unconfigured worker silently do nothing, and
		// a deployment with no database has no concurrent peer to race.
		return true, nil, nil
	}

	// Takeover and closure of the predecessor's run are one statement.
	//
	// Split, the upsert overwrites the expired row's run_id with NULL and hands
	// the old id to application code to close separately. A crash in between
	// leaves that job_run open with nothing referencing it: job_lease no longer
	// carries the id, so no later holder can ever mark it ABANDONED. Folding the
	// close in means the only row that loses its reference is one already
	// closed.
	//
	// prev reads the pre-statement snapshot, which is the dead holder's id —
	// RETURNING would see the row after the upsert and hand back the id being
	// written. It is only acted on when the upsert actually won, so a racing
	// writer making it stale cannot cause a spurious close.
	var acquired bool
	var abandoned *string
	if err := db.QueryRow(ctx, `
		WITH prev AS (
			SELECT run_id FROM job_lease WHERE job_name = $1
		),
		upserted AS (
			INSERT INTO job_lease (job_name, token, holder, expires_at, run_id)
			VALUES ($1, $2, $5, now() + $3::interval, $4::uuid)
			ON CONFLICT (job_name) DO UPDATE
			   SET token       = EXCLUDED.token,
			       holder      = EXCLUDED.holder,
			       acquired_at = now(),
			       renewed_at  = now(),
			       expires_at  = EXCLUDED.expires_at,
			       run_id      = EXCLUDED.run_id
			 WHERE job_lease.expires_at < now()
			RETURNING job_name
		),
		closed AS (
			UPDATE job_run
			   SET finished_at = now(), outcome = $6
			 WHERE id = (SELECT run_id FROM prev)
			   AND finished_at IS NULL
			   AND EXISTS (SELECT 1 FROM upserted)
			RETURNING id
		)
		SELECT EXISTS (SELECT 1 FROM upserted),
		       (SELECT id::text FROM closed)
	`, name, token, leaseTTL.String(), runID, leaseHolder, outcomeAbandoned).Scan(&acquired, &abandoned); err != nil {
		return false, nil, err
	}
	if !acquired {
		return false, nil, nil
	}
	return true, abandoned, nil
}

// openRunUnderLease opens the ledger row and attaches it to the lease in one
// transaction, and reports whether this token still holds the lease.
//
// The two must be atomic. Inserting the run and then linking it as separate
// statements leaves a window where a crash produces an open job_run with
// job_lease.run_id still NULL — so the successor that steals the expired lease
// gets no run id back and can never close that row. The orphan the lease exists
// to clean up is created by the very act of recording it.
//
// SELECT ... FOR UPDATE locks the lease row for the duration, so the token check
// and the writes cannot be separated by a concurrent acquisition. Holding a
// connection for two short statements is unlike holding one for a whole sweep,
// which is what ruled out advisory locks.
func openRunUnderLease(ctx context.Context, db *pgxpool.Pool, name, trigger, token string) (string, bool, error) {
	if db == nil {
		return "", true, nil
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		// Cannot tell whether the lease is still held. Report it as held: the
		// keeper discovers a real loss within a renewal interval, and refusing
		// to run on a transient database error would be a worse trade.
		return "", true, err
	}
	defer rollbackAfterFailure(slog.Default(), ctx, tx, "open_run_under_lease")

	var current string
	var expired bool
	err = tx.QueryRow(ctx,
		`SELECT token, expires_at <= now() FROM job_lease WHERE job_name = $1 FOR UPDATE`, name).
		Scan(&current, &expired)
	if errors.Is(err, pgx.ErrNoRows) {
		// Released or deleted from under us.
		return "", false, nil
	}
	if err != nil {
		return "", true, err
	}
	if current != token || expired {
		return "", false, nil
	}

	var runID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO job_run (job_name, trigger) VALUES ($1, $2) RETURNING id::text`,
		name, trigger).Scan(&runID); err != nil {
		return "", true, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE job_lease SET run_id = $2::uuid WHERE job_name = $1`, name, runID); err != nil {
		return "", true, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", true, err
	}
	return runID, true, nil
}

// renewJobLease extends the lease. Reports false when this process is no longer
// the holder — the lease expired and another worker took it.
func renewJobLease(ctx context.Context, db *pgxpool.Pool, name, token string) (bool, error) {
	if db == nil {
		return true, nil
	}
	tag, err := db.Exec(ctx, `
		UPDATE job_lease
		   SET renewed_at = now(), expires_at = now() + $3::interval
		 WHERE job_name = $1 AND token = $2
	`, name, token, leaseTTL.String())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// releaseJobLease drops the lease. Scoped to the holder so a slow run that
// already lost its lease cannot delete its successor's.
func releaseJobLease(ctx context.Context, db *pgxpool.Pool, name, token string) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(ctx,
		`DELETE FROM job_lease WHERE job_name = $1 AND token = $2`, name, token)
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
func startLeaseKeeper(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, name, token string, cancel context.CancelFunc) *leaseKeeper {
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
				held, err := renewJobLease(ctx, db, name, token)
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
	token := newLeaseToken()
	acquired, abandonedRun, err := acquireJobLease(ctx, db, name, token, nil)
	if err != nil {
		// Without coordination, running risks the duplicate side effects this
		// exists to prevent — and a sweep that cannot reach the database has
		// nothing to do anyway.
		return false, fmt.Errorf("acquiring job lease: %w", err)
	}
	if !acquired {
		return false, nil
	}

	// The predecessor's open run was closed as part of the takeover, not after
	// it, so there is no window in which it can lose its only reference.
	if abandonedRun != nil && *abandonedRun != "" {
		logger.Warn("closed a job run abandoned by a dead holder",
			"worker.job.name", name, "worker.job.run_id", *abandonedRun)
	}

	started := time.Now()
	runID, stillHeld, err := openRunUnderLease(ctx, db, name, trigger, token)
	if !stillHeld {
		// Displaced between acquiring and opening the run. Do not sweep: the
		// holder that replaced us is already doing it.
		logger.Warn("job lease: lost before the sweep started", "worker.job.name", name)
		return false, nil
	}
	if err != nil {
		// The run row and its link roll back together, so proceeding leaves no
		// orphan. The ledger observes sweeps; it must not be why one does not run.
		logger.Warn("job lease: failed to open ledger run", "worker.job.name", name, "error", err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	keeper := startLeaseKeeper(runCtx, db, logger, name, token, cancel)

	runErr := fn(runCtx)

	keeper.Stop()
	finishJobRun(ctx, db, logger, runID, started, runErr)
	if err := releaseJobLease(ctx, db, name, token); err != nil {
		logger.Warn("job lease: release failed", "worker.job.name", name, "error", err)
	}
	return true, runErr
}
