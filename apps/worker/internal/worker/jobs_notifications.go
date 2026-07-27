package worker

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type notificationHTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type outboundNotification struct {
	Kind        string         `json:"kind"`
	Severity    string         `json:"severity"`
	TenantID    string         `json:"tenantId"`
	WorkspaceID string         `json:"workspaceId,omitempty"`
	Title       string         `json:"title"`
	Body        string         `json:"body"`
	SourceTable string         `json:"sourceTable"`
	SourceID    string         `json:"sourceId"`
	Payload     map[string]any `json:"payload"`
	CreatedAt   string         `json:"createdAt"`
	// FailedAttempts counts prior NOTIFICATION_FAILED audit entries for this
	// notification; delivery is dead-lettered once it reaches MaxAttempts.
	FailedAttempts int `json:"-"`
}

func runNotificationSender(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, cfg NotificationConfig, client notificationHTTPClient) error {
	maxAttempts := cfg.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = defaultNotificationMaxAttempts
	}

	sent := 0
	failed := 0
	skipped := 0
	deadLettered := 0

	// 1. Legacy / OSS global webhook notification
	if cfg.WebhookURL != "" {
		notifications, err := listPendingNotifications(ctx, db, maxAttempts)
		if err != nil {
			return err
		}
		for _, notification := range notifications {
			err := deliverWithResilience(ctx, outboundBreakers, cfg.WebhookURL, func(sendCtx context.Context) error {
				return postNotification(sendCtx, cfg, client, notification)
			})
			if errors.Is(err, errBreakerOpen) {
				// Destination is cooling down: leave the event pending (no
				// audit entry) so it does not burn an attempt.
				skipped++
				continue
			}
			if err != nil {
				failed++
				attempt := notification.FailedAttempts + 1
				logger.Warn("global notification send failed", "kind", notification.Kind, "source_table", notification.SourceTable, "source_id", notification.SourceID, "attempt", attempt, "max_attempts", maxAttempts, "error", err)
				if attempt >= maxAttempts {
					deadLettered++
					logger.Error("notification dead-lettered after max attempts", "kind", notification.Kind, "source_table", notification.SourceTable, "source_id", notification.SourceID, "attempts", attempt)
				}
				if auditErr := appendNotificationAudit(ctx, db, notification, "NOTIFICATION_FAILED", err.Error(), attempt); auditErr != nil {
					return auditErr
				}
				continue
			}
			sent++
			if err := appendNotificationAudit(ctx, db, notification, "NOTIFICATION_SENT", "", notification.FailedAttempts+1); err != nil {
				return err
			}
		}
	}

	// 2. Custom workspace-scoped alerting rules (EE / Cloud tier).
	//
	// The rule x event match, the connector/risk filters, and the
	// already-delivered exclusion all run in SQL (listMatchingRuleDeliveries),
	// anti-joining the notification_delivery table, processed in keyset-cursor
	// batches. This replaces the previous O(rules x events) nested Go loop that
	// loaded every DENY event across all tenants with no LIMIT and re-scanned
	// agt_operations_log per pair. See database-optimizations-audit finding 1.
	credentialKey := os.Getenv("SPCTRE_CREDENTIAL_ENCRYPTION_KEY")
	cursor := deliveryCursor{}
	for {
		candidates, err := listMatchingRuleDeliveries(ctx, db, credentialKey, cursor, notificationMatchBatchSize, maxAttempts)
		if err != nil {
			logger.Error("failed to match alerting rules to recent events", "error", err)
			return err
		}
		if len(candidates) == 0 {
			break
		}

		for _, candidate := range candidates {
			// Advance the cursor for every candidate, delivered or not, so the
			// sweep terminates even when deliveries keep failing.
			cursor = candidate.cursor
			rule := candidate.rule
			event := candidate.event

			// Match Frequency Filter (only for the small set of candidates that
			// already passed every other filter and are not yet delivered).
			if rule.RuleMinFrequency > 1 && rule.RuleFrequencyWindowMin != nil {
				count, err := countMatchingEventsInWindow(ctx, db, event.TenantID, event.WorkspaceID, rule.RuleConnector, rule.RuleMinRiskLevel, event.CreatedAt, *rule.RuleFrequencyWindowMin)
				if err != nil {
					logger.Error("failed to count matching events for frequency window check", "error", err, "rule_id", rule.RuleID)
					continue
				}
				if count < rule.RuleMinFrequency {
					continue
				}
			}

			err := deliverWithResilience(ctx, outboundBreakers, notificationEndpointKey(rule), func(sendCtx context.Context) error {
				return postNotificationWithFormat(sendCtx, client, rule, event)
			})
			if errors.Is(err, errBreakerOpen) {
				// Destination is cooling down: leave the pair undelivered (no
				// attempt burned); a later sweep re-picks it up.
				skipped++
				continue
			}
			if err != nil {
				failed++
				attempt := candidate.failedAttempts + 1
				logger.Warn("custom alerting rule notification failed", "rule_id", rule.RuleID, "integration_id", rule.IntegrationID, "attempt", attempt, "max_attempts", maxAttempts, "error", err)
				if attempt >= maxAttempts {
					deadLettered++
					logger.Error("notification dead-lettered after max attempts", "rule_id", rule.RuleID, "integration_id", rule.IntegrationID, "event_id", event.ID, "attempts", attempt)
				}
				if deliveryErr := recordNotificationDelivery(ctx, db, event.TenantID, event.ID, rule.IntegrationID, false, err.Error()); deliveryErr != nil {
					return deliveryErr
				}
				if auditErr := appendNotificationAuditWithIntegration(ctx, db, event, rule.IntegrationID, rule.IntegrationType, "NOTIFICATION_FAILED", err.Error(), attempt); auditErr != nil {
					return auditErr
				}
				continue
			}

			sent++
			if deliveryErr := recordNotificationDelivery(ctx, db, event.TenantID, event.ID, rule.IntegrationID, true, ""); deliveryErr != nil {
				return deliveryErr
			}
			if auditErr := appendNotificationAuditWithIntegration(ctx, db, event, rule.IntegrationID, rule.IntegrationType, "NOTIFICATION_SENT", "", candidate.failedAttempts+1); auditErr != nil {
				return auditErr
			}
		}

		if len(candidates) < notificationMatchBatchSize {
			break
		}
	}

	// Backlog observability lives in a single cheap aggregate rather than in
	// the matcher query, so dead-lettered pairs never consume page slots.
	completionAttrs := []any{
		"notifications.sent", sent,
		"notifications.failed", failed,
		"notifications.skipped_breaker_open", skipped,
		"notifications.dead_lettered", deadLettered,
	}
	deadLetterBacklog, backlogErr := countDeadLetteredDeliveries(ctx, db, maxAttempts)
	if backlogErr != nil {
		// Omit the field rather than reporting 0: a zero backlog reads as
		// healthy, masking the failed count.
		logger.Warn("failed to count dead-letter backlog", "error", backlogErr)
	} else {
		completionAttrs = append(completionAttrs, "notifications.dead_letter_backlog", deadLetterBacklog)
	}

	logger.Info("notification sender complete", completionAttrs...)
	return nil
}

// countDeadLetteredDeliveries reports how many undelivered (event, integration)
// pairs updated in the last 24 hours have exhausted their delivery attempts and
// still belong to an integration with an enabled alerting rule — pairs whose
// rules were since disabled or deleted can never be re-matched by the sender,
// so counting them would inflate the backlog with undrainable rows.
func countDeadLetteredDeliveries(ctx context.Context, db *pgxpool.Pool, maxAttempts int) (int, error) {
	var count int
	err := db.QueryRow(ctx, `
		SELECT count(*)::int
		FROM notification_delivery d
		WHERE d.delivered = false
		  AND d.failed_attempts >= $1
		  AND d.updated_at >= now() - interval '24 hours'
		  AND EXISTS (
			SELECT 1 FROM alerting_rule r
			WHERE r.integration_id = d.integration_id AND r.enabled = true
		  )
	`, maxAttempts).Scan(&count)
	return count, err
}

// notificationEndpointKey resolves the destination an integration actually
// talks to, for circuit-breaker bucketing.
func notificationEndpointKey(r ruleWithIntegration) string {
	if r.IntegrationType == "PAGERDUTY" && !strings.HasPrefix(r.IntegrationURL, "http://") && !strings.HasPrefix(r.IntegrationURL, "https://") {
		return "https://events.pagerduty.com/v2/enqueue"
	}
	return r.IntegrationURL
}

type ruleWithIntegration struct {
	RuleID                 string
	RuleTenantID           string
	RuleWorkspaceID        string
	RuleName               string
	RuleConnector          *string
	RuleMinRiskLevel       *string
	RuleMinFrequency       int
	RuleFrequencyWindowMin *int
	IntegrationID          string
	IntegrationName        string
	IntegrationType        string
	IntegrationURL         string
	IntegrationConfig      []byte
}

// notificationMatchBatchSize bounds each rule/event match query so a sweep
// works through candidates in keyset-cursor pages instead of one unbounded scan.
const notificationMatchBatchSize = 500

// deliveryCursor is a keyset cursor over the matched (event, integration) pairs,
// ordered by (event created_at, event id, integration id). The zero value sorts
// before every real row, so it addresses the first page.
type deliveryCursor struct {
	createdAt     time.Time
	eventID       string
	integrationID string
}

// ruleDeliveryCandidate is one rule x event match that is not yet delivered.
type ruleDeliveryCandidate struct {
	rule           ruleWithIntegration
	event          evidenceEvent
	failedAttempts int
	cursor         deliveryCursor
}

// listMatchingRuleDeliveries matches enabled alerting rules to recent
// production DENY events in SQL — applying the tenant/workspace, connector, and
// risk-level filters and anti-joining notification_delivery to drop
// already-delivered and dead-lettered pairs — and returns one keyset-cursor
// page of candidates. See database-optimizations-audit finding 1.
func listMatchingRuleDeliveries(ctx context.Context, db *pgxpool.Pool, credentialKey string, cursor deliveryCursor, limit int, maxAttempts int) ([]ruleDeliveryCandidate, error) {
	cursorEventID := cursor.eventID
	if cursorEventID == "" {
		cursorEventID = "00000000-0000-0000-0000-000000000000"
	}
	cursorIntegrationID := cursor.integrationID
	if cursorIntegrationID == "" {
		cursorIntegrationID = "00000000-0000-0000-0000-000000000000"
	}

	rows, err := db.Query(ctx, `
		SELECT
			r.id::text,
			r.tenant_id::text,
			r.workspace_id::text,
			r.name,
			r.connector,
			r.min_risk_level,
			r.min_frequency,
			r.frequency_window_minutes,
			r.integration_id::text,
			i.name,
			i.type,
			i.url,
			CASE
				WHEN i.config_encrypted IS NOT NULL AND $1 <> ''
				THEN pgp_sym_decrypt(i.config_encrypted, $1)::text
				ELSE '{}'
			END AS config,
			ree.id::text,
			ree.decision_id,
			ree.agent_id,
			ree.connector,
			ree.action,
			ree.reason,
			ree.created_at,
			coalesce(gd.risk_level, 'LOW') AS risk_level,
			ree.status,
			ree.policy_refs,
			ree.artifact_hash,
			ree.runtime_stack,
			coalesce(d.failed_attempts, 0) AS failed_attempts
		FROM alerting_rule r
		JOIN alerting_integration i ON r.integration_id = i.id
		JOIN runtime_evidence_event ree
			ON ree.tenant_id = r.tenant_id
			AND ree.workspace_id = r.workspace_id
			AND ree.environment = 'production'
			AND ree.status = 'DENY'
			AND ree.created_at >= now() - interval '24 hours'
		LEFT JOIN gateway_decision gd
			ON gd.tenant_id = ree.tenant_id AND gd.decision_id = ree.decision_id
		LEFT JOIN notification_delivery d
			ON d.event_id = ree.id AND d.integration_id = r.integration_id
		WHERE r.enabled = true
			AND coalesce(d.delivered, false) = false
			AND coalesce(d.failed_attempts, 0) < $6
			AND (r.connector IS NULL OR r.connector = '' OR lower(ree.connector) = lower(r.connector))
			AND (
				r.min_risk_level IS NULL OR r.min_risk_level = ''
				OR (CASE upper(coalesce(gd.risk_level, 'LOW'))
						WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END)
					>= (CASE upper(r.min_risk_level)
						WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END)
			)
			AND (ree.created_at, ree.id, r.integration_id) > ($2, $3::uuid, $4::uuid)
		ORDER BY ree.created_at ASC, ree.id ASC, r.integration_id ASC
		LIMIT $5
	`, credentialKey, cursor.createdAt, cursorEventID, cursorIntegrationID, limit, maxAttempts)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var candidates []ruleDeliveryCandidate
	for rows.Next() {
		var r ruleWithIntegration
		var e evidenceEvent
		var configBytes []byte
		var failedAttempts int
		if err := rows.Scan(
			&r.RuleID, &r.RuleTenantID, &r.RuleWorkspaceID, &r.RuleName,
			&r.RuleConnector, &r.RuleMinRiskLevel, &r.RuleMinFrequency, &r.RuleFrequencyWindowMin,
			&r.IntegrationID, &r.IntegrationName, &r.IntegrationType, &r.IntegrationURL, &configBytes,
			&e.ID, &e.DecisionID, &e.AgentID, &e.Connector, &e.Action, &e.Reason,
			&e.CreatedAt, &e.RiskLevel, &e.Status, &e.PolicyRefs, &e.ArtifactHash,
			&e.RuntimeStack, &failedAttempts,
		); err != nil {
			return nil, err
		}
		r.IntegrationConfig = configBytes
		e.TenantID = r.RuleTenantID
		e.WorkspaceID = r.RuleWorkspaceID
		candidates = append(candidates, ruleDeliveryCandidate{
			rule:           r,
			event:          e,
			failedAttempts: failedAttempts,
			cursor: deliveryCursor{
				createdAt:     e.CreatedAt,
				eventID:       e.ID,
				integrationID: r.IntegrationID,
			},
		})
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return candidates, nil
}

// recordNotificationDelivery upserts the delivery state for an
// (event, integration) pair: a success marks it delivered so it is never
// re-sent; a failure increments the attempt counter that drives dead-lettering.
func recordNotificationDelivery(ctx context.Context, db *pgxpool.Pool, tenantID, eventID, integrationID string, delivered bool, errMessage string) error {
	if delivered {
		_, err := db.Exec(ctx, `
			INSERT INTO notification_delivery (tenant_id, event_id, integration_id, delivered, updated_at)
			VALUES ($1, $2, $3, true, now())
			ON CONFLICT (event_id, integration_id)
			DO UPDATE SET delivered = true, updated_at = now()
		`, tenantID, eventID, integrationID)
		return err
	}
	_, err := db.Exec(ctx, `
		INSERT INTO notification_delivery (tenant_id, event_id, integration_id, failed_attempts, last_error, updated_at)
		VALUES ($1, $2, $3, 1, $4, now())
		ON CONFLICT (event_id, integration_id)
		DO UPDATE SET failed_attempts = notification_delivery.failed_attempts + 1, last_error = $4, updated_at = now()
	`, tenantID, eventID, integrationID, errMessage)
	return err
}

type evidenceEvent struct {
	ID           string
	TenantID     string
	WorkspaceID  string
	DecisionID   string
	AgentID      string
	Connector    string
	Action       string
	Reason       string
	CreatedAt    time.Time
	RiskLevel    string
	Status       string
	PolicyRefs   []string
	ArtifactHash string
	RuntimeStack string
	ApproverDid  string
}

func riskLevelToInt(rl string) int {
	switch strings.ToUpper(rl) {
	case "LOW":
		return 1
	case "MEDIUM":
		return 2
	case "HIGH":
		return 3
	case "CRITICAL":
		return 4
	default:
		return 0
	}
}

func riskToPagerDutySeverity(rl string) string {
	switch strings.ToUpper(rl) {
	case "CRITICAL":
		return "critical"
	case "HIGH":
		return "error"
	case "MEDIUM":
		return "warning"
	default:
		return "info"
	}
}

func countMatchingEventsInWindow(ctx context.Context, db *pgxpool.Pool, tenantID, workspaceID string, connector *string, minRiskLevel *string, endtime time.Time, windowMinutes int) (int, error) {
	var allowedRisks []string
	if minRiskLevel != nil && *minRiskLevel != "" {
		minVal := riskLevelToInt(*minRiskLevel)
		for _, rl := range []string{"LOW", "MEDIUM", "HIGH", "CRITICAL"} {
			if riskLevelToInt(rl) >= minVal {
				allowedRisks = append(allowedRisks, rl)
			}
		}
	} else {
		allowedRisks = []string{"LOW", "MEDIUM", "HIGH", "CRITICAL"}
	}

	var count int
	err := db.QueryRow(ctx, `
		SELECT count(*)::int
		FROM runtime_evidence_event ree
		LEFT JOIN gateway_decision gd ON gd.tenant_id = ree.tenant_id AND gd.decision_id = ree.decision_id
		WHERE ree.tenant_id = $1
		  AND ree.workspace_id = $2
		  AND ree.environment = 'production'
		  AND ree.status = 'DENY'
		  AND ree.created_at BETWEEN $3 - ($4 * interval '1 minute') AND $3
		  AND ($5::text IS NULL OR ree.connector = $5)
		  AND (coalesce(gd.risk_level, 'LOW') = ANY($6))
	`, tenantID, workspaceID, endtime, windowMinutes, connector, allowedRisks).Scan(&count)
	return count, err
}
