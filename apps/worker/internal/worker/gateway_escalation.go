package worker

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) claimGatewayEscalation(ctx context.Context, auth gatewayInternalAuth, queueID string) (bool, error) {
	tag, err := s.db.Exec(ctx, `
		UPDATE gateway_escalation_queue
		SET
			assigned_to = $4,
			status = 'IN_REVIEW',
			updated_at = now()
		WHERE id = $1
			AND tenant_id = $2
			AND workspace_id = $3
			AND status = 'PENDING'
	`, queueID, auth.TenantID, auth.WorkspaceID, auth.ActorID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Server) resolveGatewayEscalation(ctx context.Context, auth gatewayInternalAuth, payload GatewayResolveRequest) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	var existingOutcome *string
	var existingNote *string
	var existingGuidance *string
	err = tx.QueryRow(ctx, `
		SELECT status, resolution_outcome, resolution_note, agent_guidance
		FROM gateway_escalation_queue
		WHERE id = $1
			AND tenant_id = $2
			AND workspace_id = $3
		LIMIT 1
	`, payload.QueueID, auth.TenantID, auth.WorkspaceID).Scan(&status, &existingOutcome, &existingNote, &existingGuidance)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	outcomeStr := string(payload.ResolutionOutcome)
	if status == "RESOLVED" && stringPtrEqual(existingOutcome, &outcomeStr) && stringPtrEqual(existingNote, payload.ResolutionNote) && stringPtrEqual(existingGuidance, payload.AgentGuidance) {
		return true, tx.Commit(ctx)
	}

	var gatewayDecisionID string
	err = tx.QueryRow(ctx, `
		UPDATE gateway_escalation_queue
		SET
			status = 'RESOLVED',
			resolved_at = now(),
			resolution_outcome = $4,
			resolution_note = $5,
			agent_guidance = $6,
			updated_at = now()
		WHERE id = $1
			AND tenant_id = $2
			AND workspace_id = $3
			AND status IN ('PENDING', 'IN_REVIEW')
		RETURNING gateway_decision_id
	`, payload.QueueID, auth.TenantID, auth.WorkspaceID, payload.ResolutionOutcome, payload.ResolutionNote, payload.AgentGuidance).Scan(&gatewayDecisionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE gateway_decision
		SET reviewed_by = $3, reviewed_at = now()
		WHERE id = $1 AND tenant_id = $2
	`, gatewayDecisionID, auth.TenantID, auth.ActorID); err != nil {
		return false, err
	}

	return true, tx.Commit(ctx)
}

type GoEscalationAlertContext struct {
	TenantID        string
	WorkspaceID     string
	DecisionID      string
	Connector       string
	Action          string
	RiskLevel       string
	Reason          string
	SLADueAt        string
	Consequence     *string
	DataSensitivity *string
	ToolIntent      *string
	PlanSummary     *string
}

func (s *Server) dispatchEscalationCreatedAlert(ctx context.Context, actx GoEscalationAlertContext) {
	// Try to query connector and action from runtime_evidence_event
	var connector, action string
	err := s.db.QueryRow(ctx, `
		SELECT connector, action
		FROM runtime_evidence_event
		WHERE tenant_id = $1 AND decision_id = $2
		ORDER BY created_at DESC
		LIMIT 1
	`, actx.TenantID, actx.DecisionID).Scan(&connector, &action)
	if err == nil {
		actx.Connector = connector
		actx.Action = action
	}

	credentialKey := os.Getenv("SPCTRE_CREDENTIAL_ENCRYPTION_KEY")
	if credentialKey == "" {
		s.logger.Error("SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set; skipping alerting rule evaluation to avoid decryption failure")
		return
	}

	// Query active alerting rules for this workspace
	rows, err := s.db.Query(ctx, `
		SELECT
			ar.connector,
			ar.min_risk_level,
			ai.type,
			ai.url,
			pgp_sym_decrypt(ai.config_encrypted, $3)::jsonb
		FROM alerting_rule ar
		JOIN alerting_integration ai ON ai.id = ar.integration_id
		WHERE ar.tenant_id = $1
		  AND ar.workspace_id = $2
		  AND ar.enabled = true
	`, actx.TenantID, actx.WorkspaceID, credentialKey)
	if err != nil {
		s.logger.Error("failed to query alerting rules for escalation", "error", err)
		return
	}
	defer rows.Close()

	type integrationRule struct {
		Connector    *string
		MinRiskLevel *string
		Type         string
		URL          string
		Config       []byte
	}

	var rules []integrationRule
	for rows.Next() {
		var r integrationRule
		if err := rows.Scan(&r.Connector, &r.MinRiskLevel, &r.Type, &r.URL, &r.Config); err != nil {
			s.logger.Error("failed to scan alerting rule for escalation", "error", err)
			return
		}
		rules = append(rules, r)
	}

	if len(rules) == 0 {
		return
	}

	riskOrder := map[string]int{"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
	escalationLevel := riskOrder[strings.ToUpper(actx.RiskLevel)]

	// Deduplicate by integration URL to prevent duplicate messages
	seenURLs := make(map[string]bool)

	for _, rule := range rules {
		if rule.Connector != nil && *rule.Connector != "" && !strings.EqualFold(*rule.Connector, actx.Connector) {
			continue
		}
		if rule.MinRiskLevel != nil && *rule.MinRiskLevel != "" {
			ruleLevel := riskOrder[strings.ToUpper(*rule.MinRiskLevel)]
			if escalationLevel < ruleLevel {
				continue
			}
		}

		if seenURLs[rule.URL] {
			continue
		}
		seenURLs[rule.URL] = true

		rType, rURL, rConfig := rule.Type, rule.URL, rule.Config
		s.spawn(func(ctx context.Context) { s.sendEscalationNotification(ctx, rType, rURL, rConfig, actx) })
	}
}

func (s *Server) sendEscalationNotification(ctx context.Context, itype, url string, configBytes []byte, actx GoEscalationAlertContext) {
	summary, details := formatEscalationMessage(actx)

	var body []byte
	var err error

	switch itype {
	case "SLACK":
		body, err = json.Marshal(escalationSlackPayload(summary, details))
	case "PAGERDUTY":
		var payload map[string]any
		payload, url = escalationPagerDutyPayload(summary, url, configBytes, actx)
		body, err = json.Marshal(payload)
	case "TEAMS":
		body, err = json.Marshal(escalationTeamsPayload(summary, details, actx))
	case "WEBHOOK":
		body, err = json.Marshal(escalationWebhookPayload(actx))
	default:
		return
	}

	if err != nil {
		s.logger.Error("failed to marshal escalation notification payload", "error", err)
		return
	}

	if err := deliverJSONNotification(ctx, safeHTTPClient, url, body, 5*time.Second, nil); err != nil {
		if statusErr, ok := errors.AsType[*httpStatusError](err); ok {
			s.logger.Warn("escalation notification returned bad status", "status", statusErr.status, "url", url)
			return
		}
		s.logger.Error("failed to send escalation notification", "error", err, "url", url)
	}
}

// formatEscalationMessage renders the human-facing summary line and the
// markdown detail block shared by the Slack/Teams escalation payloads.
func formatEscalationMessage(actx GoEscalationAlertContext) (summary, details string) {
	connectorAction := actx.Connector
	if actx.Action != "" {
		connectorAction = connectorAction + "." + actx.Action
	}
	if connectorAction == "" {
		connectorAction = actx.DecisionID
	}
	summary = "🚨 New escalation: " + connectorAction + " (" + actx.RiskLevel + " risk)"

	detailsParts := []string{
		"**Decision ID**: " + actx.DecisionID,
		"**Risk Level**: " + actx.RiskLevel,
		"**Reason**: " + actx.Reason,
	}
	if actx.Consequence != nil && *actx.Consequence != "" {
		detailsParts = append(detailsParts, "**Consequence**: "+*actx.Consequence)
	}
	if actx.DataSensitivity != nil && *actx.DataSensitivity != "" {
		detailsParts = append(detailsParts, "**Data Sensitivity**: "+*actx.DataSensitivity)
	}
	if actx.ToolIntent != nil && *actx.ToolIntent != "" {
		detailsParts = append(detailsParts, "**Tool Intent**: "+*actx.ToolIntent)
	}
	if actx.PlanSummary != nil && *actx.PlanSummary != "" {
		detailsParts = append(detailsParts, "**Plan Summary**: "+*actx.PlanSummary)
	}
	detailsParts = append(detailsParts, "**SLA Due**: "+actx.SLADueAt)
	return summary, strings.Join(detailsParts, "\n")
}

func escalationSlackPayload(summary, details string) map[string]any {
	// summary/details carry agent-controlled fields (reason, toolIntent,
	// planSummary); escape Slack's special characters so they cannot inject
	// link syntax (`<url|text>`) into the mrkdwn block — same treatment as the
	// custom-alerting formatter in jobs_notification_delivery.go. Our own
	// formatting (`**`, newlines) is unaffected by the escaping.
	return map[string]any{
		"text": escapeSlack(summary),
		"blocks": []any{
			map[string]any{
				"type": "header",
				"text": map[string]any{
					"type": "plain_text",
					"text": "🚨 Spctre Escalation",
				},
			},
			map[string]any{
				"type": "section",
				"text": map[string]any{
					"type": "mrkdwn",
					"text": strings.ReplaceAll(escapeSlack(details), "**", "*"),
				},
			},
		},
	}
}

// Teams MessageCard text renders markdown, and summary/details carry
// agent-controlled fields (reason, toolIntent, planSummary) — escape link
// syntax (`[text](url)`) so an agent cannot inject a masked attacker link into
// the escalation card; mirrors the Slack escaping in escalationSlackPayload.
// Our own formatting (`**`, newlines) uses none of the escaped characters.
var teamsMarkdownEscaper = strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`)

func escapeTeamsMarkdown(s string) string {
	return teamsMarkdownEscaper.Replace(s)
}

func escalationTeamsPayload(summary, details string, actx GoEscalationAlertContext) map[string]any {
	themeColor := "0078D7"
	switch strings.ToUpper(actx.RiskLevel) {
	case "CRITICAL":
		themeColor = "FF0000"
	case "HIGH":
		themeColor = "FFA500"
	}
	return map[string]any{
		"@type":      "MessageCard",
		"themeColor": themeColor,
		"summary":    escapeTeamsMarkdown(summary),
		"sections": []any{
			map[string]any{
				"activityTitle": escapeTeamsMarkdown(summary),
				"text":          escapeTeamsMarkdown(details),
			},
		},
	}
}

// escalationPagerDutyPayload builds the Events API v2 payload and returns the
// resolved endpoint URL alongside it (routing key/endpoint resolution is shared
// with the custom-alerting path via resolvePagerDutyRouting).
func escalationPagerDutyPayload(summary, url string, configBytes []byte, actx GoEscalationAlertContext) (map[string]any, string) {
	routingKey, endpoint := resolvePagerDutyRouting(url, configBytes)
	payload := map[string]any{
		"routing_key":  routingKey,
		"event_action": "trigger",
		"payload": map[string]any{
			"summary":  summary,
			"source":   "spctre-gateway",
			"severity": riskToPagerDutySeverity(actx.RiskLevel),
			"custom_details": map[string]any{
				"decisionId": actx.DecisionID,
				"connector":  actx.Connector,
				"riskLevel":  actx.RiskLevel,
			},
		},
	}
	return payload, endpoint
}

func escalationWebhookPayload(actx GoEscalationAlertContext) map[string]any {
	return map[string]any{
		"event":       "escalation.created",
		"decisionId":  actx.DecisionID,
		"connector":   actx.Connector,
		"action":      actx.Action,
		"riskLevel":   actx.RiskLevel,
		"reason":      actx.Reason,
		"consequence": actx.Consequence,
		"slaDueAt":    actx.SLADueAt,
		"toolIntent":  actx.ToolIntent,
		"planSummary": actx.PlanSummary,
		"timestamp":   time.Now().Format(time.RFC3339),
	}
}
