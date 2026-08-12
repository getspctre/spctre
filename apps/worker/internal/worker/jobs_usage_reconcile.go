package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// usageDriftLogThreshold is the absolute change in a period's retained count
// that counts as material enough to record in the operations log.
//
// Retained counts move constantly as evidence ages out of a tenant's window, so
// recording every correction would bury the ones that matter. A jump larger
// than this is more likely a metering fault — a lost transaction, a restore, a
// manual deletion — than ordinary retention churn.
const usageDriftLogThreshold = 100

type usageMeasurement struct {
	tenantID      string
	periodID      string
	previous      *int64
	retained      int64
	capacity      *int64
	overCap       bool
	capNotifiedAt *time.Time
}

// runUsageReconciliation audits each tenant's retained-event measurement
// against durable evidence.
//
// retained_count is maintained incrementally: ingest increments it, and the
// prune and expired-delete paths discount what they remove. That keeps the
// figure current at O(1) per event, which a recount cannot do — a recount is
// O(retained events) and would have to run constantly to keep a displayed
// number fresh.
//
// This job exists because an incrementally maintained counter cannot repair
// itself. A failed transaction, a restore, or a manual deletion leaves it
// permanently wrong, and an unrepairable billing measure is worse than a stale
// one. So the recount is the authority and the deltas are the fast path: drift
// between audits is expected and corrected here.
//
// It also seeds the gauge. Until this runs, retained_count is NULL and the
// delta paths deliberately skip it, because a period row counting up from zero
// would claim a tenant holds a handful of events when it may hold millions
// carried over from earlier months.
//
// The count comes from runtime_evidence_event_key rather than
// runtime_evidence_event: the key table holds exactly one row per retained
// event, is not partitioned, and is keyed (tenant_id, decision_id), so this is
// an index-only scan instead of a tenant_id scan fanned out across every
// monthly partition. See database-optimizations-audit finding 5.
func runUsageReconciliation(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	measurements, err := measureOpenUsagePeriods(ctx, db)
	if err != nil {
		return err
	}
	if len(measurements) == 0 {
		return nil
	}

	reconciled := 0
	for _, m := range measurements {
		if err := applyUsageMeasurement(ctx, db, m); err != nil {
			// One tenant's measurement failing must not abandon the rest.
			logger.Error("failed to apply reconciled usage measurement",
				"error", err, "tenant_id", m.tenantID)
			continue
		}
		reconciled++
	}
	logger.Info("reconciled retained-event usage", "periods", reconciled, "considered", len(measurements))
	return nil
}

// measureOpenUsagePeriods reads the current measurement alongside a freshly
// computed retained count, without writing. Reading first keeps the previous
// value available for drift detection; an UPDATE ... RETURNING cannot report
// both the old and new value without relying on snapshot subtleties.
func measureOpenUsagePeriods(ctx context.Context, db *pgxpool.Pool) ([]usageMeasurement, error) {
	rows, err := db.Query(ctx, `
		SELECT
			tup.tenant_id::text,
			tup.id::text,
			tup.retained_count,
			COALESCE(retained.retained_count, 0) AS measured,
			-- Capacity is read from the profile rather than derived from
			-- plan_code: provisioning materializes it from whichever
			-- entitlement catalog the deployment supplies, so the plan ladder
			-- is not duplicated here in a second language — and a deployment
			-- with no commercial catalog materializes NULL, which is no cap.
			COALESCE(tcp.retained_event_capacity, tup.included_capacity) AS capacity,
			tup.cap_notified_at
		FROM tenant_usage_period tup
		JOIN tenant_commercial_profile tcp ON tcp.tenant_id = tup.tenant_id
		LEFT JOIN (
			SELECT tenant_id, count(*) AS retained_count
			FROM runtime_evidence_event_key
			GROUP BY tenant_id
		) retained ON retained.tenant_id = tup.tenant_id
		WHERE tup.metric = 'RETAINED_EVENTS'
		  -- Only the open period is measured. A closed period's measurement is
		  -- the record of what was billed and must not move afterwards.
		  AND now() >= tup.period_start
		  AND now() < tup.period_end
	`)
	if err != nil {
		return nil, fmt.Errorf("measuring open usage periods: %w", err)
	}
	defer rows.Close()

	measurements := []usageMeasurement{}
	for rows.Next() {
		var m usageMeasurement
		if err := rows.Scan(&m.tenantID, &m.periodID, &m.previous, &m.retained, &m.capacity, &m.capNotifiedAt); err != nil {
			return nil, fmt.Errorf("scanning usage measurement: %w", err)
		}
		m.overCap = m.capacity != nil && m.retained > *m.capacity
		measurements = append(measurements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading usage measurements: %w", err)
	}
	return measurements, nil
}

// applyUsageMeasurement persists one period's measurement, and records a
// material correction in the operations log in the same transaction so the
// audit entry cannot survive a failed write of the value it describes.
func applyUsageMeasurement(ctx context.Context, db *pgxpool.Pool, m usageMeasurement) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	overageState := "WITHIN_CAPACITY"
	if m.overCap {
		overageState = "OVER_CAPACITY"
	}

	if _, err := tx.Exec(ctx, `
		UPDATE tenant_usage_period
		SET retained_count = $2,
		    included_capacity = COALESCE($3, included_capacity),
		    overage_state = $4,
		    measured_at = now(),
		    updated_at = now()
		WHERE id = $1::uuid
	`, m.periodID, m.retained, m.capacity, overageState); err != nil {
		return fmt.Errorf("persisting usage measurement: %w", err)
	}

	// Record the moment a period first exceeds its included capacity.
	//
	// The cap is soft by design: ingest is never refused, the tenant is told,
	// and the overage is metered. cap_notified_at is the idempotency guard, so a
	// tenant is notified once per period rather than once per audit for as long
	// as it stays over. It is set in the same transaction as the measurement
	// that justified it.
	//
	// This is recorded for every tenant regardless of deployment plan. The
	// record is tenant-scoped fact; whether it becomes an upgrade prompt is a
	// presentation decision, made where the deployment's plan is known.
	if m.overCap && m.capNotifiedAt == nil {
		if err := notifyCapacityExceeded(ctx, tx, m); err != nil {
			return fmt.Errorf("recording capacity transition: %w", err)
		}
	}

	// A first measurement is not drift — there is nothing to have drifted from.
	if m.previous != nil {
		drift := m.retained - *m.previous
		if drift < 0 {
			drift = -drift
		}
		if drift >= usageDriftLogThreshold {
			payload := map[string]any{
				"metric":           "RETAINED_EVENTS",
				"previousRetained": *m.previous,
				"measuredRetained": m.retained,
				"drift":            m.retained - *m.previous,
				"overageState":     overageState,
			}
			if m.capacity != nil {
				payload["includedCapacity"] = *m.capacity
			}
			if err := appendGenericOperationsLogTx(ctx, tx, m.tenantID, "", "USAGE_RECONCILED",
				m.periodID, "tenant_usage_period", "system", payload); err != nil {
				return fmt.Errorf("recording usage reconciliation: %w", err)
			}
		}
	}

	return tx.Commit(ctx)
}

// notifyCapacityExceeded records that a tenant's period crossed its included
// capacity, and stamps the guard that keeps it to once per period.
//
// commercial_event already carries USAGE_LIMIT_EXCEEDED, so this needs no new
// event type — the type was defined for exactly this and had no producer.
func notifyCapacityExceeded(ctx context.Context, tx pgx.Tx, m usageMeasurement) error {
	metadata := map[string]any{
		"metric":        "RETAINED_EVENTS",
		"retainedCount": m.retained,
		"periodId":      m.periodID,
	}
	if m.capacity != nil {
		metadata["includedCapacity"] = *m.capacity
		metadata["overageCount"] = m.retained - *m.capacity
	}
	metadataBytes, err := json.Marshal(metadata)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO commercial_event (tenant_id, event_type, metadata)
		VALUES ($1, 'USAGE_LIMIT_EXCEEDED', $2::jsonb)
	`, m.tenantID, string(metadataBytes)); err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		UPDATE tenant_usage_period SET cap_notified_at = now() WHERE id = $1::uuid
	`, m.periodID)
	return err
}
