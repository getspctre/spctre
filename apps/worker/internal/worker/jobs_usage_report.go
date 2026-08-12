package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runUsageReporting asks the control plane to report each tenant's closed,
// unreported billing periods to the billing provider.
//
// The work itself lives in the control plane because it needs the entitlement
// catalog and the commercial billing slot, neither of which the worker has.
// This job owns only the schedule and the fan-out, the same division as the
// retention sweep's archival handoff.
//
// Reporting is a request per tenant rather than one sweep. A provider outage
// affecting one tenant then fails that tenant's request and leaves everyone
// else's billing to proceed, where a single batched call would stall all of it.
//
// Nothing here decides what is owed. The control plane claims each submission
// against an idempotency key before calling the provider, so a repeated run —
// after a crash, a redeploy, or a manual trigger — resumes rather than
// re-reporting.
func runUsageReporting(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	tenantIDs, err := tenantsWithUnreportedPeriods(ctx, db)
	if err != nil {
		return err
	}
	if len(tenantIDs) == 0 {
		return nil
	}

	apiURL := os.Getenv("SPCTRE_API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:3000"
	}
	secret := os.Getenv("SPCTRE_WORKER_INTERNAL_SECRET")
	client := &http.Client{Timeout: 30 * time.Second}

	reported := 0
	for _, tenantID := range tenantIDs {
		if err := requestUsageReport(ctx, client, apiURL, secret, tenantID); err != nil {
			// One tenant's provider trouble must not abandon the rest. The
			// submission row records the attempt, so the next run resumes it.
			logger.Error("usage report request failed", "error", err, "tenant_id", tenantID)
			continue
		}
		reported++
	}

	logger.Info("requested usage reporting", "tenants", reported, "considered", len(tenantIDs))
	return nil
}

// tenantsWithUnreportedPeriods finds tenants holding a closed, measured period
// that no non-failed submission covers.
//
// Mirrors listUnreportedClosedPeriods in
// apps/web/lib/repositories/usage/metering.ts. The worker only needs to know
// *which* tenants to ask; the control plane re-derives the periods themselves
// under tenant context, so a drift between the two costs an unnecessary request
// rather than a wrong bill.
func tenantsWithUnreportedPeriods(ctx context.Context, db *pgxpool.Pool) ([]string, error) {
	rows, err := db.Query(ctx, `
		SELECT DISTINCT p.tenant_id::text
		FROM tenant_usage_period p
		WHERE p.period_end <= now()
		  AND p.retained_count IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1
			FROM tenant_usage_submission s
			WHERE s.usage_period_id = p.id
			  AND s.status <> 'FAILED'
		  )
	`)
	if err != nil {
		return nil, fmt.Errorf("finding tenants with unreported usage: %w", err)
	}
	defer rows.Close()

	tenantIDs := []string{}
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			return nil, fmt.Errorf("scanning tenant with unreported usage: %w", err)
		}
		tenantIDs = append(tenantIDs, tenantID)
	}
	return tenantIDs, rows.Err()
}

func requestUsageReport(
	ctx context.Context,
	client *http.Client,
	apiURL string,
	secret string,
	tenantID string,
) error {
	payload, err := json.Marshal(map[string]any{"tenantId": tenantID})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, apiURL+"/api/internal/report-usage", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	// Drain before close so the connection can be reused across tenants.
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	if readErr != nil {
		return readErr
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("report-usage returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
