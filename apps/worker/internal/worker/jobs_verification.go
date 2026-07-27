package worker

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

func runVerificationSweep(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
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
