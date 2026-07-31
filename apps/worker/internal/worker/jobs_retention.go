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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func runRetention(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	if _, err := db.Exec(ctx, `SELECT spctre_ensure_runtime_evidence_partitions(1, 6)`); err != nil {
		return err
	}

	// 1. Prune staging evidence unconditionally after 2 days, in bounded batches.
	prunedStaging, err := batchedPruneEvidence(ctx, db,
		`environment = 'staging' AND created_at < now() - interval '2 days'`)
	if err != nil {
		return err
	}
	if prunedStaging > 0 {
		logger.Info("pruned expired staging evidence records", "count", prunedStaging)
	}

	// 2. Select expired production evidence records per tenant based on their plan
	rowsProd, err := db.Query(ctx, `
		SELECT ree.tenant_id::text, ree.decision_id
		FROM runtime_evidence_event ree
		JOIN tenant_commercial_profile tcp ON ree.tenant_id = tcp.tenant_id
		WHERE ree.environment = 'production'
		  AND (
		    (
		      (tcp.downgraded_at IS NULL OR tcp.downgraded_at < now() - interval '365 days')
		      AND ree.created_at < now() - make_interval(days => 
		        COALESCE(
		          tcp.retention_window_days,
		          CASE tcp.plan_code
		            WHEN 'HOSTED_TRIAL' THEN 90
		            WHEN 'TEAM' THEN 365
		            WHEN 'BUSINESS' THEN 1095
		            WHEN 'ENTERPRISE' THEN 2555
		            ELSE 90
		          END
		        )
		      )
		    )
		    OR
		    (
		      tcp.downgraded_at IS NOT NULL AND tcp.downgraded_at >= now() - interval '365 days'
		      AND ree.created_at < now() - interval '1095 days'
		    )
		  )
	`)
	if err != nil {
		return err
	}
	defer rowsProd.Close()

	type item struct {
		tenantID   string
		decisionID string
	}
	expiredItems := []item{}
	for rowsProd.Next() {
		var it item
		if err := rowsProd.Scan(&it.tenantID, &it.decisionID); err != nil {
			return err
		}
		expiredItems = append(expiredItems, it)
	}
	if err := rowsProd.Err(); err != nil {
		return err
	}

	if len(expiredItems) > 0 {
		tenantToDecisions := make(map[string][]string)
		for _, it := range expiredItems {
			tenantToDecisions[it.tenantID] = append(tenantToDecisions[it.tenantID], it.decisionID)
		}

		apiURL := os.Getenv("SPCTRE_API_URL")
		if apiURL == "" {
			apiURL = "http://localhost:3000"
		}
		secret := os.Getenv("SPCTRE_WORKER_INTERNAL_SECRET")

		client := &http.Client{Timeout: 15 * time.Second}

		for tenantID, decisionIDs := range tenantToDecisions {
			archivePayload := map[string]any{
				"tenantId":    tenantID,
				"decisionIds": decisionIDs,
			}
			payloadBytes, err := json.Marshal(archivePayload)
			if err != nil {
				logger.Error("failed to marshal archive payload", "error", err)
				continue
			}

			req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL+"/api/internal/archive-evidence", bytes.NewReader(payloadBytes))
			if err != nil {
				logger.Error("failed to create archive request", "error", err)
				continue
			}
			req.Header.Set("Content-Type", "application/json")
			if secret != "" {
				req.Header.Set("Authorization", "Bearer "+secret)
			}

			resp, err := client.Do(req)
			if err != nil {
				logger.Error("failed to send archive request to control plane", "error", err, "tenant_id", tenantID)
				continue
			}
			// Drain before close so the connection can be reused (keep-alive);
			// closing an unread body forces a new TLS handshake per tenant per
			// sweep. See concurrency-and-memory-audit finding 11.
			if _, err := io.Copy(io.Discard, resp.Body); err != nil {
				logger.Warn("failed to drain archive response body", "error", err, "tenant_id", tenantID)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				logger.Error("control plane archive endpoint returned non-200 status", "status", resp.StatusCode, "tenant_id", tenantID)
				continue
			}

			// Delete archived records from the database in batches, rather than
			// one round trip per decision_id. See database-optimizations-audit
			// finding 3.
			for start := 0; start < len(decisionIDs); start += retentionDeleteBatchSize {
				end := min(start+retentionDeleteBatchSize, len(decisionIDs))
				chunk := decisionIDs[start:end]
				if _, err := db.Exec(ctx, `
					DELETE FROM runtime_evidence_event
					WHERE tenant_id = $1
					  AND decision_id = ANY($2)
				`, tenantID, chunk); err != nil {
					logger.Error("failed to delete archived evidence records", "error", err, "tenant_id", tenantID)
					break
				}
				if _, err := db.Exec(ctx, `
					DELETE FROM runtime_evidence_event_key
					WHERE tenant_id = $1
					  AND decision_id = ANY($2)
				`, tenantID, chunk); err != nil {
					logger.Error("failed to delete archived evidence keys", "error", err, "tenant_id", tenantID)
				}
			}
			logger.Info("successfully archived and pruned production evidence records", "tenant_id", tenantID, "count", len(decisionIDs))
		}
	}

	// 3. Prune other environments unconditionally after DefaultComplianceRetentionDays.
	prunedDefault, err := batchedPruneEvidence(ctx, db,
		`environment <> ALL($1::text[]) AND created_at < now() - make_interval(days => $2)`,
		[]string{"production", "staging"}, DefaultComplianceRetentionDays)
	if err != nil {
		return err
	}
	if prunedDefault > 0 {
		logger.Info("pruned expired default environment evidence records", "count", prunedDefault)
	}

	// 3b. Reclaim whole monthly partitions that the batched deletes above have
	// emptied, instead of leaving them as empty relations forever.
	if err := dropEmptyExpiredEvidencePartitions(ctx, db, logger); err != nil {
		return fmt.Errorf("dropping empty expired evidence partitions: %w", err)
	}

	// 4. Prune webhook replay-check records older than 2 hours.
	tag, err := db.Exec(ctx, `
		DELETE FROM gateway_webhook_replay_check
		WHERE first_seen < now() - interval '2 hours'
	`)
	if err != nil {
		return fmt.Errorf("pruning webhook replay cache: %w", err)
	}
	if tag.RowsAffected() > 0 {
		logger.Info("pruned expired webhook replay check records", "count", tag.RowsAffected())
	}

	// 5. Prune consumed magic-link nonces once the underlying link has expired
	// (the link is already invalid, so the single-use record is no longer needed).
	consumedTag, err := db.Exec(ctx, `
		DELETE FROM consumed_magic_link
		WHERE expires_at < now()
	`)
	if err != nil {
		return fmt.Errorf("pruning consumed magic-link nonces: %w", err)
	}
	if consumedTag.RowsAffected() > 0 {
		logger.Info("pruned expired consumed magic-link nonces", "count", consumedTag.RowsAffected())
	}

	// 6. Prune expired SAML AuthnRequest IDs (migrations 076/077). The callback
	// marks validated IDs consumed; this clears consumed and abandoned rows once
	// they expire so the replay-protection cache does not grow unbounded.
	if err := pruneExpiredSamlAuthnRequests(ctx, db, logger); err != nil {
		return err
	}

	return nil
}

// pruneExpiredSamlAuthnRequests deletes SAML AuthnRequest cache rows past their
// expiry.
func pruneExpiredSamlAuthnRequests(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	// Worker and migration rollouts are independent. Treat the SAML cache as an
	// optional dependency until its migration has reached this database, rather
	// than failing the entire retention tick after its other work completed.
	var exists bool
	if err := db.QueryRow(ctx, `SELECT to_regclass('saml_authn_request') IS NOT NULL`).Scan(&exists); err != nil {
		return fmt.Errorf("checking SAML AuthnRequest cache table: %w", err)
	}
	if !exists {
		logger.Warn("skipping SAML AuthnRequest cache prune; table is not migrated")
		return nil
	}

	tag, err := db.Exec(ctx, `
		DELETE FROM saml_authn_request
		WHERE expires_at < now()
	`)
	if err != nil {
		return fmt.Errorf("pruning expired SAML AuthnRequest ids: %w", err)
	}
	if tag.RowsAffected() > 0 {
		logger.Info("pruned expired SAML AuthnRequest ids", "count", tag.RowsAffected())
	}
	return nil
}

// retentionDeleteBatchSize bounds each retention DELETE so a sweep never runs
// as one giant transaction (WAL spike, long row locks on the partitions ingest
// writes to, vacuum debt) and never buffers an unbounded RETURNING set in Go.
// See database-optimizations-audit finding 3.
const retentionDeleteBatchSize = 5000

// batchedPruneEvidence deletes runtime_evidence_event rows matching whereSQL in
// bounded ctid batches, pruning the matching key rows after each batch, until a
// batch comes back short. whereSQL is a trusted constant (never user input);
// its placeholders bind positionally to args.
func batchedPruneEvidence(ctx context.Context, db *pgxpool.Pool, whereSQL string, args ...any) (int, error) {
	// Delete by the (id, created_at) primary key, not ctid: runtime_evidence_event
	// is range-partitioned, so ctid is only unique within a partition and an
	// "IN (SELECT ctid ...)" delete across the parent could match rows in other
	// partitions.
	query := fmt.Sprintf(`
		DELETE FROM runtime_evidence_event
		WHERE (id, created_at) IN (
			SELECT id, created_at FROM runtime_evidence_event
			WHERE %s
			LIMIT %d
		)
		RETURNING tenant_id::text, decision_id
	`, whereSQL, retentionDeleteBatchSize)

	total := 0
	for {
		rows, err := db.Query(ctx, query, args...)
		if err != nil {
			return total, err
		}
		byTenant := make(map[string][]string)
		batchCount := 0
		for rows.Next() {
			var tenantID, decisionID string
			if err := rows.Scan(&tenantID, &decisionID); err != nil {
				rows.Close()
				return total, err
			}
			byTenant[tenantID] = append(byTenant[tenantID], decisionID)
			batchCount++
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return total, err
		}
		rows.Close()

		for tenantID, decisionIDs := range byTenant {
			if err := pruneEvidenceKeysBatched(ctx, db, tenantID, decisionIDs); err != nil {
				return total, err
			}
		}

		total += batchCount
		if batchCount < retentionDeleteBatchSize {
			break
		}
	}
	return total, nil
}

// pruneEvidenceKeysBatched deletes runtime_evidence_event_key rows for a tenant
// in chunks with a single ANY() delete per chunk, rather than one round trip
// per decision_id.
func pruneEvidenceKeysBatched(ctx context.Context, db *pgxpool.Pool, tenantID string, decisionIDs []string) error {
	for start := 0; start < len(decisionIDs); start += retentionDeleteBatchSize {
		end := min(start+retentionDeleteBatchSize, len(decisionIDs))
		if _, err := db.Exec(ctx, `
			DELETE FROM runtime_evidence_event_key
			WHERE tenant_id = $1
			  AND decision_id = ANY($2)
		`, tenantID, decisionIDs[start:end]); err != nil {
			return err
		}
	}
	return nil
}

// evidencePartitionSuffixLayout parses the YYYY_MM suffix of a monthly
// runtime_evidence_event partition name (matches spctre_ensure_runtime_evidence_partitions).
const evidencePartitionSuffixLayout = "2006_01"

// dropEmptyExpiredEvidencePartitions is the structural half of
// database-optimizations-audit finding 3: runtime_evidence_event is
// range-partitioned by month, so once the batched deletes above drain a past
// month's rows its partition lingers as an empty relation (catalog bloat plus a
// per-query partition-planning cost). This drops those emptied partitions in
// O(1) — no WAL spike, row locks, or vacuum debt.
//
// It deliberately drops ONLY empty partitions whose month has fully elapsed. It
// never drops a partition that still holds rows: production evidence must be
// archived to the control plane before deletion (step 2) and per-plan retention
// windows run to years, so a non-empty partition may hold un-archived or
// still-retained evidence and must go through the row-level path. Emptiness is
// the safety gate — a 0-row partition drops with no data loss regardless of
// retention/archival state. month_end <= now() excludes the current partition
// and the future partitions pre-created by spctre_ensure_runtime_evidence_partitions.
func dropEmptyExpiredEvidencePartitions(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) error {
	rows, err := db.Query(ctx, `
		SELECT c.relname
		FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		JOIN pg_class p ON p.oid = i.inhparent
		WHERE p.relname = 'runtime_evidence_event'
		  AND c.relname ~ '^runtime_evidence_event_[0-9]{4}_[0-9]{2}$'
	`)
	if err != nil {
		return err
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	now := time.Now().UTC()
	dropped := 0
	for _, name := range names {
		monthStart, err := time.Parse(evidencePartitionSuffixLayout, name[len("runtime_evidence_event_"):])
		if err != nil {
			continue // not a monthly partition we manage
		}
		// Skip the current partition and any future partitions: only months whose
		// entire range is in the past are eligible.
		if monthStart.AddDate(0, 1, 0).After(now) {
			continue
		}
		wasDropped, err := dropEvidencePartitionIfEmpty(ctx, db, name)
		if err != nil {
			return err
		}
		if wasDropped {
			dropped++
		}
	}
	if dropped > 0 {
		logger.Info("dropped empty expired evidence partitions", "count", dropped)
	}
	return nil
}

// dropEvidencePartitionIfEmpty drops the named partition only if it is empty,
// holding an ACCESS EXCLUSIVE lock across the emptiness check and the drop so a
// concurrent (back-dated) insert cannot slip a row in between the two. Returns
// whether the partition was dropped. The name comes from the catalog and is
// regex-validated as a monthly partition by the caller; it is quoted with
// pgx.Identifier.Sanitize so it can be interpolated safely.
func dropEvidencePartitionIfEmpty(ctx context.Context, db *pgxpool.Pool, name string) (bool, error) {
	ident := pgx.Identifier{name}.Sanitize()
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "LOCK TABLE "+ident+" IN ACCESS EXCLUSIVE MODE"); err != nil {
		return false, err
	}
	var hasRows bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM "+ident+")").Scan(&hasRows); err != nil {
		return false, err
	}
	if hasRows {
		return false, nil
	}
	if _, err := tx.Exec(ctx, "DROP TABLE "+ident); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
