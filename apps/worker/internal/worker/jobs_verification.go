package worker

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

func runVerificationSweep(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	// Staleness is durable platform state, not merely a periodic log signal.
	// Producers may additionally mark VERIFIER_DIGEST or POLICY_CONTENT drift;
	// the sweep owns the time-based baseline for every verifier kind.
	if _, err := db.Exec(ctx, `
		UPDATE agt_verification_result
		SET stale_at = COALESCE(stale_at, now()),
			stale_reasons = CASE
				WHEN 'AGE' = ANY(stale_reasons) THEN stale_reasons
				ELSE array_append(stale_reasons, 'AGE')
			END
		WHERE created_at < now() - make_interval(days => $1)
	`, VerificationStaleDays); err != nil {
		return err
	}

	rows, err := db.Query(ctx, `
		SELECT DISTINCT ON (run_by, verification_type)
			run_by,
			verification_type
		FROM agt_verification_result
		WHERE created_at < now() - make_interval(days => $1)
		ORDER BY run_by, verification_type, created_at DESC
	`, VerificationStaleDays)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		count++
	}
	if rows.Err() != nil {
		return rows.Err()
	}
	if count > 0 {
		logger.Warn("stale verification results detected", "count", count)
	} else {
		logger.Info("all verification results are current")
	}
	return nil
}
