package worker

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var sentinelWorkspaceIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// slackMrkdwnEscaper neutralizes Slack's three special characters so that
// untrusted evidence fields (reason, agentId, connector, action, rule name)
// cannot inject Slack link syntax (`<url|text>`) or other markup when rendered
// in a mrkdwn block. JSON marshaling already prevents payload injection; this
// covers the *content* layer that Slack interprets after decoding. Per Slack's
// formatting guidance only &, <, and > require escaping.
var slackMrkdwnEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

func escapeSlack(s string) string {
	return slackMrkdwnEscaper.Replace(s)
}

func formatPayload(r ruleWithIntegration, e evidenceEvent) ([]byte, error) {
	switch r.IntegrationType {
	case "SLACK":
		payload := map[string]any{
			"blocks": []map[string]any{
				{
					"type": "header",
					"text": map[string]any{
						"type": "plain_text",
						"text": "🚨 Spctre Policy Violation Alert",
					},
				},
				{
					"type": "section",
					"text": map[string]any{
						"type": "mrkdwn",
						"text": fmt.Sprintf("*Rule:* %s\n*Agent:* %s\n*Connector/Action:* %s/%s\n*Outcome:* DENIED\n*Reason:* %s", escapeSlack(r.RuleName), escapeSlack(e.AgentID), escapeSlack(e.Connector), escapeSlack(e.Action), escapeSlack(e.Reason)),
					},
				},
				{
					"type": "section",
					"fields": []map[string]any{
						{
							"type": "mrkdwn",
							"text": fmt.Sprintf("*Tenant ID:*\n`%s`", e.TenantID),
						},
						{
							"type": "mrkdwn",
							"text": fmt.Sprintf("*Workspace ID:*\n`%s`", e.WorkspaceID),
						},
						{
							"type": "mrkdwn",
							"text": fmt.Sprintf("*Decision ID:*\n`%s`", e.DecisionID),
						},
						{
							"type": "mrkdwn",
							"text": fmt.Sprintf("*Risk Level:*\n`%s`", e.RiskLevel),
						},
					},
				},
			},
		}
		b, err := json.Marshal(payload)
		return b, err

	case "TEAMS":
		payload := map[string]any{
			"type": "message",
			"attachments": []map[string]any{
				{
					"contentType": "application/vnd.microsoft.card.adaptive",
					"content": map[string]any{
						"type": "AdaptiveCard",
						"body": []map[string]any{
							{
								"type":   "TextBlock",
								"size":   "Medium",
								"weight": "Bolder",
								"text":   "🚨 Spctre Policy Violation Alert",
							},
							{
								"type": "FactSet",
								"facts": []map[string]any{
									{"title": "Rule", "value": r.RuleName},
									{"title": "Agent", "value": e.AgentID},
									{"title": "Connector/Action", "value": fmt.Sprintf("%s/%s", e.Connector, e.Action)},
									{"title": "Risk Level", "value": e.RiskLevel},
									{"title": "Reason", "value": e.Reason},
									{"title": "Tenant ID", "value": e.TenantID},
									{"title": "Workspace ID", "value": e.WorkspaceID},
									{"title": "Decision ID", "value": e.DecisionID},
								},
							},
						},
						"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
						"version": "1.2",
					},
				},
			},
		}
		b, err := json.Marshal(payload)
		return b, err

	case "PAGERDUTY":
		routingKey := r.IntegrationURL
		if len(r.IntegrationConfig) > 0 {
			var cfg map[string]any
			if err := json.Unmarshal(r.IntegrationConfig, &cfg); err == nil {
				if rk, ok := cfg["routingKey"].(string); ok && rk != "" {
					routingKey = rk
				}
			}
		}
		if strings.HasPrefix(routingKey, "http://") || strings.HasPrefix(routingKey, "https://") {
			routingKey = "default"
		}
		payload := map[string]any{
			"routing_key":  routingKey,
			"event_action": "trigger",
			"payload": map[string]any{
				"summary":  fmt.Sprintf("%s: %s (Risk: %s)", r.RuleName, e.Reason, e.RiskLevel),
				"source":   "spctre-control-plane",
				"severity": riskToPagerDutySeverity(e.RiskLevel),
				"custom_details": map[string]any{
					"tenantId":    e.TenantID,
					"workspaceId": e.WorkspaceID,
					"decisionId":  e.DecisionID,
					"agentId":     e.AgentID,
					"connector":   e.Connector,
					"action":      e.Action,
					"reason":      e.Reason,
				},
			},
		}
		b, err := json.Marshal(payload)
		return b, err

	case "WEBHOOK":
		payload := map[string]any{
			"kind":        "custom_alerting_rule",
			"ruleName":    r.RuleName,
			"tenantId":    e.TenantID,
			"workspaceId": e.WorkspaceID,
			"decisionId":  e.DecisionID,
			"agentId":     e.AgentID,
			"connector":   e.Connector,
			"action":      e.Action,
			"reason":      e.Reason,
			"riskLevel":   e.RiskLevel,
			"createdAt":   e.CreatedAt.UTC().Format(time.RFC3339),
		}
		b, err := json.Marshal(payload)
		return b, err

	case "SPLUNK_HEC":
		var cfg map[string]any
		if len(r.IntegrationConfig) > 0 {
			if err := json.Unmarshal(r.IntegrationConfig, &cfg); err != nil {
				return nil, fmt.Errorf("splunk: invalid integration config: %w", err)
			}
		}
		hecEvent := map[string]any{
			"sourcetype": "spctre:decision",
			"source":     "spctre-control-plane",
			"time":       float64(e.CreatedAt.UnixMilli()) / 1000.0,
			"event": map[string]any{
				"ruleName":      r.RuleName,
				"tenantId":      e.TenantID,
				"workspaceId":   e.WorkspaceID,
				"decisionId":    e.DecisionID,
				"agentId":       e.AgentID,
				"connector":     e.Connector,
				"action":        e.Action,
				"decision":      e.Status,
				"riskLevel":     e.RiskLevel,
				"policyRefs":    e.PolicyRefs,
				"agtBundleHash": e.ArtifactHash,
				"runtimeTarget": e.RuntimeStack,
				"approverDid":   e.ApproverDid,
				"reason":        e.Reason,
				"createdAt":     e.CreatedAt.UTC().Format(time.RFC3339),
			},
		}
		if idx, ok := cfg["index"].(string); ok && idx != "" {
			hecEvent["index"] = idx
		}
		b, err := json.Marshal(hecEvent)
		return b, err

	case "SENTINEL":
		events := []map[string]any{
			{
				"RuleName":      r.RuleName,
				"TenantId":      e.TenantID,
				"WorkspaceId":   e.WorkspaceID,
				"DecisionId":    e.DecisionID,
				"AgentId":       e.AgentID,
				"Connector":     e.Connector,
				"Action":        e.Action,
				"Decision":      e.Status,
				"RiskLevel":     e.RiskLevel,
				"PolicyRefs":    strings.Join(e.PolicyRefs, ","),
				"AgtBundleHash": e.ArtifactHash,
				"RuntimeTarget": e.RuntimeStack,
				"ApproverDid":   e.ApproverDid,
				"Reason":        e.Reason,
				"CreatedAt":     e.CreatedAt.UTC().Format(time.RFC3339),
			},
		}
		b, err := json.Marshal(events)
		return b, err

	default:
		return nil, fmt.Errorf("unsupported integration type: %s", r.IntegrationType)
	}
}

func postNotificationWithFormat(ctx context.Context, client notificationHTTPClient, r ruleWithIntegration, e evidenceEvent) error {
	body, err := formatPayload(r, e)
	if err != nil {
		return err
	}

	if r.IntegrationType == "SENTINEL" {
		return postSentinelNotification(ctx, client, r, body)
	}

	url := r.IntegrationURL
	if r.IntegrationType == "PAGERDUTY" {
		_, url = resolvePagerDutyRouting(r.IntegrationURL, r.IntegrationConfig)
	}

	var extraHeaders map[string]string
	if r.IntegrationType == "SPLUNK_HEC" {
		var cfg map[string]any
		if len(r.IntegrationConfig) > 0 {
			if err := json.Unmarshal(r.IntegrationConfig, &cfg); err != nil {
				return fmt.Errorf("splunk: invalid integration config: %w", err)
			}
		}
		if token, ok := cfg["token"].(string); ok && token != "" {
			extraHeaders = map[string]string{"Authorization": "Splunk " + token}
		}
	}

	return deliverJSONNotification(ctx, client, url, body, 10*time.Second, extraHeaders)
}

func postSentinelNotification(ctx context.Context, client notificationHTTPClient, r ruleWithIntegration, body []byte) error {
	var cfg map[string]any
	if len(r.IntegrationConfig) > 0 {
		if err := json.Unmarshal(r.IntegrationConfig, &cfg); err != nil {
			return fmt.Errorf("sentinel: invalid config: %w", err)
		}
	}
	primaryKey, _ := cfg["primaryKey"].(string)
	logType, _ := cfg["logType"].(string)
	workspaceID := r.IntegrationURL
	if primaryKey == "" || workspaceID == "" {
		return fmt.Errorf("sentinel: workspaceId (url) and primaryKey (config) are required")
	}
	return sendToSentinel(ctx, client, workspaceID, primaryKey, logType, body)
}

// sendToSentinel posts body to the Microsoft Sentinel Log Analytics Data Collector API.
// Shared by both the rule-triggered alerting path (43-A) and the streaming forwarder (43-B).
func sendToSentinel(ctx context.Context, client notificationHTTPClient, workspaceID, primaryKey, logType string, body []byte) error {
	if !sentinelWorkspaceIDRe.MatchString(strings.ToLower(workspaceID)) {
		return fmt.Errorf("sentinel: workspaceId must be a valid UUID")
	}
	if logType == "" {
		logType = "SpctrePolicyEvent"
	}
	date := time.Now().UTC().Format(http.TimeFormat)
	stringToSign := fmt.Sprintf("POST\n%d\napplication/json\nx-ms-date:%s\n/api/logs", len(body), date)
	keyBytes, err := base64.StdEncoding.DecodeString(primaryKey)
	if err != nil {
		return fmt.Errorf("sentinel: invalid primary key encoding: %w", err)
	}
	mac := hmac.New(sha256.New, keyBytes)
	mac.Write([]byte(stringToSign))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	endpoint := fmt.Sprintf("https://%s.ods.opinsights.azure.com/api/logs?api-version=2016-04-01", workspaceID)
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Log-Type", logType)
	req.Header.Set("x-ms-date", date)
	req.Header.Set("Authorization", fmt.Sprintf("SharedKey %s:%s", workspaceID, signature))
	req.Header.Set("User-Agent", "spctre-worker-notifications/1")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &httpStatusError{status: resp.StatusCode, msg: "sentinel notification"}
	}
	return nil
}

func appendNotificationAuditWithIntegration(ctx context.Context, db *pgxpool.Pool, e evidenceEvent, integrationID string, integrationType string, eventType string, errorMessage string, attempt int) error {
	payload := map[string]any{
		"notificationKind": "custom_alerting_rule",
		"integrationId":    integrationID,
		"integrationType":  integrationType,
		"severity":         strings.ToLower(e.RiskLevel),
		"title":            "Custom Alerting Rule violation",
		"body":             fmt.Sprintf("%s was denied for %s.%s: %s", e.AgentID, e.Connector, e.Action, e.Reason),
		"payload": map[string]any{
			"decisionId": e.DecisionID,
			"agentId":    e.AgentID,
			"connector":  e.Connector,
			"action":     e.Action,
			"reason":     e.Reason,
			"riskLevel":  e.RiskLevel,
		},
	}
	if attempt > 0 {
		payload["attempt"] = attempt
	}
	if errorMessage != "" {
		payload["error"] = errorMessage
	}
	return appendGenericOperationsLog(ctx, db, e.TenantID, e.WorkspaceID, eventType, e.ID, "runtime_evidence_event", "agent:notification-sender-v1", payload)
}

// listPendingNotifications returns undelivered notifications. Only a
// NOTIFICATION_SENT audit entry suppresses redelivery; failed attempts are
// retried on later sweeps until maxAttempts dead-letters the notification.
func listPendingNotifications(ctx context.Context, db *pgxpool.Pool, maxAttempts int) ([]outboundNotification, error) {
	notifications := []outboundNotification{}

	criticalRows, err := db.Query(ctx, `
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
			delivery.failed_attempts
		FROM runtime_evidence_event ree
		CROSS JOIN LATERAL (
			SELECT
				count(*) FILTER (WHERE ol.event_type = 'NOTIFICATION_SENT') AS sent_count,
				count(*) FILTER (WHERE ol.event_type = 'NOTIFICATION_FAILED')::int AS failed_attempts
			FROM agt_operations_log ol
			WHERE ol.tenant_id = ree.tenant_id
				AND ol.source_table = 'runtime_evidence_event'
				AND ol.source_id = ree.id::text
				AND ol.event_type IN ('NOTIFICATION_SENT', 'NOTIFICATION_FAILED')
				AND ol.payload->>'notificationKind' = 'critical_policy_violation'
		) delivery
		WHERE ree.environment = 'production'
			AND ree.status = 'DENY'
			AND ree.created_at >= now() - interval '24 hours'
			AND delivery.sent_count = 0
			AND delivery.failed_attempts < $1
		ORDER BY ree.created_at ASC
		LIMIT 100
	`, maxAttempts)
	if err != nil {
		return nil, err
	}
	defer criticalRows.Close()
	for criticalRows.Next() {
		var sourceID, tenantID, workspaceID, decisionID, agentID, connector, action, reason string
		var createdAt time.Time
		var failedAttempts int
		if err := criticalRows.Scan(&sourceID, &tenantID, &workspaceID, &decisionID, &agentID, &connector, &action, &reason, &createdAt, &failedAttempts); err != nil {
			return nil, err
		}
		notifications = append(notifications, outboundNotification{
			Kind:        "critical_policy_violation",
			Severity:    "critical",
			TenantID:    tenantID,
			WorkspaceID: workspaceID,
			Title:       "Production policy denial",
			Body:        fmt.Sprintf("%s was denied for %s.%s: %s", agentID, connector, action, reason),
			SourceTable: "runtime_evidence_event",
			SourceID:    sourceID,
			Payload: map[string]any{
				"decisionId": decisionID,
				"agentId":    agentID,
				"connector":  connector,
				"action":     action,
				"reason":     reason,
			},
			CreatedAt:      createdAt.UTC().Format(time.RFC3339),
			FailedAttempts: failedAttempts,
		})
	}
	if criticalRows.Err() != nil {
		return nil, criticalRows.Err()
	}

	slaRows, err := db.Query(ctx, `
		SELECT
			ol.id::text,
			ol.tenant_id::text,
			coalesce(ol.workspace_id::text, ''),
			ol.payload,
			ol.created_at,
			delivery.failed_attempts
		FROM agt_operations_log ol
		CROSS JOIN LATERAL (
			SELECT
				count(*) FILTER (WHERE sent.event_type = 'NOTIFICATION_SENT') AS sent_count,
				count(*) FILTER (WHERE sent.event_type = 'NOTIFICATION_FAILED')::int AS failed_attempts
			FROM agt_operations_log sent
			WHERE sent.tenant_id = ol.tenant_id
				AND sent.source_table = 'agt_operations_log'
				AND sent.source_id = ol.id::text
				AND sent.event_type IN ('NOTIFICATION_SENT', 'NOTIFICATION_FAILED')
				AND sent.payload->>'notificationKind' = 'escalation_sla_reminder'
		) delivery
		WHERE ol.event_type = 'AGENT_TRIAGE'
			AND ol.payload->>'action' IN ('SLA_DUE_SOON', 'SLA_OVERDUE')
			AND ol.created_at >= now() - interval '24 hours'
			AND delivery.sent_count = 0
			AND delivery.failed_attempts < $1
		ORDER BY ol.created_at ASC
		LIMIT 100
	`, maxAttempts)
	if err != nil {
		return nil, err
	}
	defer slaRows.Close()
	for slaRows.Next() {
		var sourceID, tenantID, workspaceID string
		var payload map[string]any
		var createdAt time.Time
		var failedAttempts int
		if err := slaRows.Scan(&sourceID, &tenantID, &workspaceID, &payload, &createdAt, &failedAttempts); err != nil {
			return nil, err
		}
		action, _ := payload["action"].(string)
		severity := "warning"
		title := "Escalation SLA due soon"
		if action == "SLA_OVERDUE" {
			severity = "critical"
			title = "Escalation SLA overdue"
		}
		body := fmt.Sprintf("Queue item %v for decision %v requires reviewer attention.", payload["queueId"], payload["decisionId"])
		notifications = append(notifications, outboundNotification{
			Kind:           "escalation_sla_reminder",
			Severity:       severity,
			TenantID:       tenantID,
			WorkspaceID:    workspaceID,
			Title:          title,
			Body:           body,
			SourceTable:    "agt_operations_log",
			SourceID:       sourceID,
			Payload:        payload,
			CreatedAt:      createdAt.UTC().Format(time.RFC3339),
			FailedAttempts: failedAttempts,
		})
	}
	if slaRows.Err() != nil {
		return nil, slaRows.Err()
	}

	return notifications, nil
}

func postNotification(ctx context.Context, cfg NotificationConfig, client notificationHTTPClient, notification outboundNotification) error {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body, err := json.Marshal(notification)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, cfg.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "spctre-worker-notifications/1")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &httpStatusError{status: resp.StatusCode, msg: "notification webhook"}
	}
	return nil
}

func appendNotificationAudit(ctx context.Context, db *pgxpool.Pool, notification outboundNotification, eventType string, errorMessage string, attempt int) error {
	payload := map[string]any{
		"notificationKind": notification.Kind,
		"severity":         notification.Severity,
		"title":            notification.Title,
		"body":             notification.Body,
		"payload":          notification.Payload,
	}
	if attempt > 0 {
		payload["attempt"] = attempt
	}
	if errorMessage != "" {
		payload["error"] = errorMessage
	}
	return appendGenericOperationsLog(ctx, db, notification.TenantID, notification.WorkspaceID, eventType, notification.SourceID, notification.SourceTable, "agent:notification-sender-v1", payload)
}

func appendGenericOperationsLog(ctx context.Context, db *pgxpool.Pool, tenantID string, workspaceID string, eventType string, sourceID string, sourceTable string, actorID string, payload map[string]any) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := appendGenericOperationsLogTx(ctx, tx, tenantID, workspaceID, eventType, sourceID, sourceTable, actorID, payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// --- §43-B: SIEM Event Streaming Forwarder ---
