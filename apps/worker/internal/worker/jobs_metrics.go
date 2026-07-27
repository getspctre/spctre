package worker

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

func runMetricsSweep(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	var pending, inReview int
	rows, err := db.Query(ctx, `
		SELECT status, count(*)::int
		FROM gateway_escalation_queue
		WHERE status IN ('PENDING', 'IN_REVIEW')
		GROUP BY status
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			rows.Close()
			return err
		}
		switch status {
		case "PENDING":
			pending = count
		case "IN_REVIEW":
			inReview = count
		}
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}

	var nearSLA int
	if err := db.QueryRow(ctx, `
		SELECT count(*)::int
		FROM gateway_escalation_queue
		WHERE status = 'PENDING'
		  AND sla_due_at IS NOT NULL
		  AND sla_due_at < now() + interval '30 minutes'
	`).Scan(&nearSLA); err != nil {
		return err
	}
	logger.Info("metrics sweep", "gateway.pending", pending, "gateway.in_review", inReview, "gateway.near_sla", nearSLA)
	return nil
}
