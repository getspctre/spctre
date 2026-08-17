package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type siemStream struct {
	ID              string
	TenantID        string
	WorkspaceID     string
	Name            string
	Type            string
	URL             string
	Config          []byte
	CredentialsJSON string // decrypted via pgp_sym_decrypt at query time
	LastForwardedAt *time.Time
	LastForwardedID *string
	CreatedAt       time.Time
	// ConsecutiveFailures counts sends that failed since the last success.
	// Reaching the ceiling suspends the stream.
	ConsecutiveFailures int
}

func listSiemStreams(ctx context.Context, db *pgxpool.Pool, credentialKey string) ([]siemStream, error) {
	rows, err := db.Query(ctx, `
		SELECT
			id::text,
			tenant_id::text,
			workspace_id::text,
			name,
			type,
			url,
			config,
			CASE
				WHEN credentials_encrypted IS NOT NULL AND $1 <> ''
				THEN pgp_sym_decrypt(credentials_encrypted, $1)::text
				ELSE '{}'
			END AS credentials_json,
			last_forwarded_at,
			last_forwarded_id,
			created_at,
			consecutive_failures
		FROM workspace_siem_stream
		WHERE enabled = true
		ORDER BY created_at ASC
	`, credentialKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var streams []siemStream
	for rows.Next() {
		var s siemStream
		if err := rows.Scan(
			&s.ID, &s.TenantID, &s.WorkspaceID, &s.Name, &s.Type,
			&s.URL, &s.Config, &s.CredentialsJSON, &s.LastForwardedAt, &s.LastForwardedID, &s.CreatedAt,
			&s.ConsecutiveFailures,
		); err != nil {
			return nil, err
		}
		streams = append(streams, s)
	}
	return streams, nil
}

func listEventsForSiemForwarding(ctx context.Context, db *pgxpool.Pool, tenantID, workspaceID string, sinceAt time.Time, sinceID string, limit int) ([]evidenceEvent, error) {
	rows, err := db.Query(ctx, `
		SELECT
			ree.id::text,
			ree.tenant_id::text,
			ree.workspace_id::text,
			ree.decision_id,
			ree.agent_id,
			ree.connector,
			ree.action,
			ree.reason,
			ree.created_at,
			coalesce(gd.risk_level, 'LOW') as risk_level,
			ree.status,
			ree.policy_refs,
			ree.artifact_hash,
			ree.runtime_stack,
			coalesce(appr.approver_did, '') as approver_did
		FROM runtime_evidence_event ree
		LEFT JOIN gateway_decision gd ON gd.tenant_id = ree.tenant_id AND gd.decision_id = ree.decision_id
		-- approver_did is an AGT tamper-evidence field carried on the verification
		-- result for the governing artifact, not on the evidence row. Source the
		-- most recent approval for the event's artifact so the SIEM payload
		-- forwards a real DID instead of an empty string. Served by
		-- agt_verification_result_artifact_idx (tenant_id, artifact_hash, created_at DESC).
		LEFT JOIN LATERAL (
			SELECT avr.approver_did
			FROM agt_verification_result avr
			WHERE avr.tenant_id     = ree.tenant_id
			  AND avr.workspace_id  = ree.workspace_id
			  AND avr.artifact_hash = ree.artifact_hash
			  AND avr.approver_did IS NOT NULL
			ORDER BY avr.created_at DESC
			LIMIT 1
		) appr ON true
		WHERE ree.tenant_id    = $1
		  AND ree.workspace_id = $2
		  AND ree.environment  = 'production'
		  AND (ree.created_at, ree.id) > ($3, $4::uuid)
		  AND ree.created_at   <= now() - interval '5 seconds'
		ORDER BY ree.created_at ASC, ree.id ASC
		LIMIT $5
	`, tenantID, workspaceID, sinceAt, sinceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []evidenceEvent
	for rows.Next() {
		var e evidenceEvent
		if err := rows.Scan(
			&e.ID, &e.TenantID, &e.WorkspaceID, &e.DecisionID,
			&e.AgentID, &e.Connector, &e.Action, &e.Reason,
			&e.CreatedAt, &e.RiskLevel,
			&e.Status, &e.PolicyRefs, &e.ArtifactHash, &e.RuntimeStack,
			&e.ApproverDid,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

func updateSiemStreamCursor(ctx context.Context, db *pgxpool.Pool, streamID string, lastAt time.Time, lastID string) error {
	_, err := db.Exec(ctx,
		`UPDATE workspace_siem_stream SET last_forwarded_at = $2, last_forwarded_id = $3, updated_at = now() WHERE id = $1`,
		streamID, lastAt, lastID,
	)
	return err
}

func buildSiemEventPayload(e evidenceEvent) map[string]any {
	return map[string]any{
		"decisionId":    e.DecisionID,
		"agentId":       e.AgentID,
		"tenantId":      e.TenantID,
		"workspaceId":   e.WorkspaceID,
		"connector":     e.Connector,
		"action":        e.Action,
		"decision":      e.Status,
		"reason":        e.Reason,
		"riskLevel":     e.RiskLevel,
		"policyRefs":    e.PolicyRefs,
		"agtBundleHash": e.ArtifactHash,
		"runtimeTarget": e.RuntimeStack,
		"approverDid":   e.ApproverDid,
		"createdAt":     e.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func sendSplunkHecBatch(ctx context.Context, client notificationHTTPClient, stream siemStream, events []evidenceEvent) error {
	var cfg map[string]any
	if len(stream.Config) > 0 {
		if err := json.Unmarshal(stream.Config, &cfg); err != nil {
			return fmt.Errorf("splunk: invalid config: %w", err)
		}
	}
	var creds map[string]any
	if len(stream.CredentialsJSON) > 0 {
		if err := json.Unmarshal([]byte(stream.CredentialsJSON), &creds); err != nil {
			return fmt.Errorf("splunk: invalid credentials: %w", err)
		}
	}
	token, _ := creds["token"].(string)
	index, _ := cfg["index"].(string)

	var buf bytes.Buffer
	for _, e := range events {
		entry := map[string]any{
			"time":       float64(e.CreatedAt.UnixMilli()) / 1000.0,
			"sourcetype": "spctre:decision",
			"source":     "spctre-control-plane",
			"event":      buildSiemEventPayload(e),
		}
		if index != "" {
			entry["index"] = index
		}
		line, err := json.Marshal(entry)
		if err != nil {
			return err
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, stream.URL, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "spctre-worker-siem/1")
	if token != "" {
		req.Header.Set("Authorization", "Splunk "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &httpStatusError{status: resp.StatusCode, msg: "splunk HEC batch"}
	}
	return nil
}

func sendSentinelBatch(ctx context.Context, client notificationHTTPClient, stream siemStream, events []evidenceEvent) error {
	var cfg map[string]any
	if len(stream.Config) > 0 {
		if err := json.Unmarshal(stream.Config, &cfg); err != nil {
			return fmt.Errorf("sentinel: invalid config: %w", err)
		}
	}
	var creds map[string]any
	if len(stream.CredentialsJSON) > 0 {
		if err := json.Unmarshal([]byte(stream.CredentialsJSON), &creds); err != nil {
			return fmt.Errorf("sentinel: invalid credentials: %w", err)
		}
	}
	primaryKey, _ := creds["primaryKey"].(string)
	logType, _ := cfg["logType"].(string)
	workspaceID := stream.URL
	if primaryKey == "" || workspaceID == "" {
		return fmt.Errorf("sentinel: workspaceId (url) and primaryKey (credentials) are required")
	}

	records := make([]map[string]any, 0, len(events))
	for _, e := range events {
		records = append(records, buildSiemEventPayload(e))
	}
	body, err := json.Marshal(records)
	if err != nil {
		return err
	}
	return sendToSentinel(ctx, client, workspaceID, primaryKey, logType, body)
}

func sendSiemBatch(ctx context.Context, client notificationHTTPClient, stream siemStream, events []evidenceEvent) error {
	switch stream.Type {
	case "SPLUNK_HEC":
		return sendSplunkHecBatch(ctx, client, stream, events)
	case "SENTINEL":
		return sendSentinelBatch(ctx, client, stream, events)
	default:
		return fmt.Errorf("unsupported SIEM stream type: %s", stream.Type)
	}
}

// defaultSiemMaxAttempts mirrors defaultNotificationMaxAttempts: both bound how
// long a broken destination is retried before an operator has to look at it.
const defaultSiemMaxAttempts = 5

// siemErrorTextLimit keeps a pathological upstream error from growing the row
// without bound. Enough to identify the failure; not a log replacement.
const siemErrorTextLimit = 1000

// recordSiemFailure counts a failed send and suspends the stream once it
// reaches maxAttempts, returning the new count and whether this call suspended
// it.
//
// Suspension disables the stream rather than skipping the batch. The cursor is
// untouched, so re-enabling resumes exactly where delivery stopped and loses
// no events — which is the point: SIEM export carries compliance evidence, and
// advancing past a batch to keep the queue moving would turn a loud, fixable
// failure into a silent, permanent gap.
//
// Counting and suspension happen in one statement so two workers racing on the
// same stream cannot both read a stale count.
func recordSiemFailure(ctx context.Context, db *pgxpool.Pool, streamID, errText string, maxAttempts int) (int, bool, error) {
	if len(errText) > siemErrorTextLimit {
		errText = errText[:siemErrorTextLimit]
	}
	var failures int
	var suspended bool
	err := db.QueryRow(ctx, `
		UPDATE workspace_siem_stream
		   SET consecutive_failures = consecutive_failures + 1,
		       last_error           = $2,
		       last_failure_at      = now(),
		       enabled      = CASE WHEN consecutive_failures + 1 >= $3 THEN false ELSE enabled END,
		       suspended_at = CASE WHEN consecutive_failures + 1 >= $3 THEN now() ELSE suspended_at END,
		       updated_at           = now()
		 WHERE id = $1::uuid
		RETURNING consecutive_failures, (consecutive_failures >= $3)
	`, streamID, errText, maxAttempts).Scan(&failures, &suspended)
	return failures, suspended, err
}

// clearSiemFailures resets the counter after a successful send. Guarded so a
// healthy stream does not take a write on every sweep.
func clearSiemFailures(ctx context.Context, db *pgxpool.Pool, streamID string) error {
	_, err := db.Exec(ctx, `
		UPDATE workspace_siem_stream
		   SET consecutive_failures = 0,
		       last_error           = NULL,
		       last_failure_at      = NULL,
		       suspended_at         = NULL,
		       updated_at           = now()
		 WHERE id = $1::uuid AND consecutive_failures > 0
	`, streamID)
	return err
}

func runSiemForwarder(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, client notificationHTTPClient) error {
	credentialKey := os.Getenv("SPCTRE_CREDENTIAL_ENCRYPTION_KEY")
	maxAttempts := envInt("WORKER_SIEM_MAX_ATTEMPTS", defaultSiemMaxAttempts)
	streams, err := listSiemStreams(ctx, db, credentialKey)
	if err != nil {
		return err
	}
	if len(streams) == 0 {
		return nil
	}

	sent := 0
	failed := 0
	skipped := 0
	suspended := 0

	for _, stream := range streams {
		sinceAt := stream.CreatedAt
		sinceID := "00000000-0000-0000-0000-000000000000"
		if stream.LastForwardedAt != nil {
			sinceAt = *stream.LastForwardedAt
		}
		if stream.LastForwardedID != nil {
			sinceID = *stream.LastForwardedID
		}
		events, err := listEventsForSiemForwarding(ctx, db, stream.TenantID, stream.WorkspaceID, sinceAt, sinceID, 100)
		if err != nil {
			logger.Error("siem forwarder: failed to list events", "stream_id", stream.ID, "error", err)
			failed++
			continue
		}
		if len(events) == 0 {
			continue
		}
		// Breaker + retry around the batch send. On breaker-open or failure
		// the cursor is not advanced, so the same events are retried on the
		// next sweep (at-least-once).
		err = deliverWithResilience(ctx, outboundBreakers, stream.URL, func(sendCtx context.Context) error {
			return sendSiemBatch(sendCtx, client, stream, events)
		})
		// Breaker-open is not an attempt: nothing was sent, so counting it
		// would suspend a stream for being rate-limited by our own breaker
		// rather than for being broken.
		if errors.Is(err, errBreakerOpen) {
			skipped++
			continue
		}
		if err != nil {
			logger.Warn("siem forwarder: batch send failed", "stream_id", stream.ID, "type", stream.Type, "error", err)
			failed++
			failures, suspendedNow, recordErr := recordSiemFailure(ctx, db, stream.ID, err.Error(), maxAttempts)
			if recordErr != nil {
				logger.Error("siem forwarder: failed to record send failure", "stream_id", stream.ID, "error", recordErr)
			} else if suspendedNow {
				suspended++
				logger.Error("siem stream suspended after max consecutive failures",
					"stream_id", stream.ID, "type", stream.Type, "attempts", failures,
					"max_attempts", maxAttempts, "last_error", err.Error(),
					"remedy", "re-enable the stream once the destination is reachable; the cursor is unchanged so no events are lost")
			}
			continue
		}
		last := events[len(events)-1]
		if err := updateSiemStreamCursor(ctx, db, stream.ID, last.CreatedAt, last.ID); err != nil {
			logger.Error("siem forwarder: cursor update failed", "stream_id", stream.ID, "error", err)
			return err
		}
		// A delivered batch clears the streak: the ceiling counts consecutive
		// failures, so an endpoint that recovers gets its full budget back
		// rather than being suspended by unrelated failures weeks apart.
		if stream.ConsecutiveFailures > 0 {
			if err := clearSiemFailures(ctx, db, stream.ID); err != nil {
				logger.Error("siem forwarder: failed to clear failure state", "stream_id", stream.ID, "error", err)
			}
		}
		sent += len(events)
		logger.Info("siem forwarder: batch forwarded", "stream_id", stream.ID, "type", stream.Type, "count", len(events))
	}

	logger.Info("siem-forwarder complete", "events.sent", sent, "streams.failed", failed, "streams.skipped_breaker_open", skipped, "streams.suspended", suspended)
	return nil
}
