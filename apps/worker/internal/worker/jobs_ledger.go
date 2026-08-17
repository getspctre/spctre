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
	outcomeSuccess   = "SUCCESS"
	outcomeFailed    = "FAILED"
	outcomeAbandoned = "ABANDONED"
)

// jobRunRetention bounds how long sweep history is kept. Long enough to answer
// "when did this start failing" across a holiday, short enough that the table
// stays trivial: the four five-minute sweeps dominate at roughly 1,160 rows a
// day, so this settles near 35k rows.
const jobRunRetention = 30 * 24 * time.Hour

// beginJobRun opens a ledger row and returns its id.
//
// It first closes any run of the same job left open by a process that died.
// The per-job advisory lock permits one run at a time and releases when its
// session ends, so a new run starting is proof the previous one is gone. That
// makes orphan closure exact without a reaper or a staleness timeout — and a
// job that never runs again keeps its open row, which is harmless because the
// signal that matters there is the absence of a recent success.
//
// Returns an empty id if the ledger write fails. Callers treat that as
// "unrecorded" and carry on: the ledger observes sweeps, it must not become a
// new way for them to fail.
func beginJobRun(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, name, trigger string) string {
	if db == nil {
		return ""
	}

	if _, err := db.Exec(ctx, `
		UPDATE job_run
		   SET finished_at = now(), outcome = $2
		 WHERE job_name = $1 AND finished_at IS NULL
	`, name, outcomeAbandoned); err != nil {
		// Not fatal: a stale open row is worth less than the sweep itself.
		logger.Warn("job ledger: failed to close abandoned runs", "worker.job.name", name, "error", err)
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
