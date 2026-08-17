package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// JobTrigger records what caused a sweep to run.
const (
	// TriggerTicker is the worker's own in-process scheduler.
	TriggerTicker = "TICKER"
	// TriggerHTTP is an external scheduler calling /internal/jobs/*.
	TriggerHTTP = "HTTP"
)

const (
	outcomeSuccess = "SUCCESS"
	outcomeFailed  = "FAILED"
	// outcomeAbandoned is intentionally unwritten today. Marking a run
	// abandoned requires knowing it is dead rather than slow, and nothing here
	// carries that liveness yet — see beginJobRun. It stays declared alongside
	// the migration's CHECK constraint so the heartbeat sweep that will write
	// it does not have to reintroduce the value.
	outcomeAbandoned = "ABANDONED"
)

var _ = outcomeAbandoned

// jobRunRetention bounds how long sweep history is kept. Long enough to answer
// "when did this start failing" across a holiday, short enough that the table
// stays trivial: the four five-minute sweeps dominate at roughly 1,160 rows a
// day, so this settles near 35k rows.
const jobRunRetention = 30 * 24 * time.Hour

// beginJobRun opens a ledger row and returns its id.
//
// It deliberately does not close other open rows for the same job. Doing that
// would need "a new run starting proves the previous one is dead", and that is
// not true here: only the HTTP job endpoints take the per-job advisory lock
// (runJobEndpoint), while the in-process ticker takes no lock at all. Two runs
// of one job can therefore overlap — across replicas, or between the ticker and
// an external scheduler — and closing on start would stamp a live run as
// ABANDONED, corrupting exactly the signal this table exists to provide.
//
// So an interrupted run stays open, and "started, never finished" is recorded
// truthfully rather than guessed at. Distinguishing a dead run from a slow one
// needs liveness this row does not carry; the intended follow-up is a heartbeat
// refreshed during the run, which is safe under concurrency because it proves
// liveness directly instead of inferring it. ABANDONED remains a valid outcome
// for that sweep to write.
//
// Returns an empty id if the ledger write fails. Callers treat that as
// "unrecorded" and carry on: the ledger observes sweeps, it must not become a
// new way for them to fail.
func beginJobRun(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, name, trigger string) string {
	if db == nil {
		return ""
	}

	var id string
	if err := db.QueryRow(ctx, `
		INSERT INTO job_run (job_name, trigger) VALUES ($1, $2) RETURNING id::text
	`, name, trigger).Scan(&id); err != nil {
		logger.Warn("job ledger: failed to open run", "worker.job.name", name, "error", err)
		return ""
	}
	return id
}

// finishJobRun closes a ledger row. A blank id means the open failed, so there
// is nothing to close.
//
// Deliberately a second short statement rather than one transaction spanning
// the sweep: holding a connection for the duration would tie up a meaningful
// share of a small pool for as long as a retention sweep takes.
func finishJobRun(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, id string, started time.Time, runErr error) {
	if db == nil || id == "" {
		return
	}

	outcome := outcomeSuccess
	var errText *string
	if runErr != nil {
		outcome = outcomeFailed
		msg := runErr.Error()
		errText = &msg
	}

	if _, err := db.Exec(ctx, `
		UPDATE job_run
		   SET finished_at = now(), outcome = $2, error = $3, duration_ms = $4
		 WHERE id = $1::uuid
	`, id, outcome, errText, time.Since(started).Milliseconds()); err != nil {
		logger.Warn("job ledger: failed to close run", "worker.job.run_id", id, "error", err)
	}
}

// pruneJobRuns drops sweep history past the retention window. Called from the
// retention sweep, which already prunes on the same cadence.
func pruneJobRuns(ctx context.Context, db *pgxpool.Pool) (int64, error) {
	tag, err := db.Exec(ctx, `DELETE FROM job_run WHERE started_at < now() - $1::interval`,
		jobRunRetention.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
