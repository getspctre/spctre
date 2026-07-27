import { logger } from "@spctre/platform/logging";
import { createHmac } from "crypto";
import { getConnectorActionByDecisionId } from "@/lib/repositories/evidence/runtime";
import { listActiveAlertingRulesWithIntegrations } from "@/lib/repositories/alerting";
import { sendAlertEmail } from "@/lib/email";
import { safeFetch } from "@/lib/platform/safe-fetch";

interface EscalationAlertContext {
  tenantId: string;
  workspaceId: string;
  decisionId: string;
  connector?: string;
  action?: string;
  riskLevel: string;
  reason: string;
  slaDueAt: string;
  consequence?: string;
  dataSensitivity?: string;
  toolIntent?: string;
  planSummary?: string;
}

interface AlertingIntegration {
  id: string;
  type: 'SLACK' | 'PAGERDUTY' | 'TEAMS' | 'EMAIL' | 'WEBHOOK' | 'SPLUNK_HEC' | 'SENTINEL';
  url: string;
  config: Record<string, unknown>;
}

/**
 * Dispatches notifications to configured alerting integrations when a new
 * escalation is created. Fire-and-forget — never blocks the decide response.
 */
export async function dispatchEscalationCreatedAlert(ctx: EscalationAlertContext): Promise<void> {
  try {
    // Fetch all enabled alerting rules + integrations for this workspace via repository
    const rules = await listActiveAlertingRulesWithIntegrations(ctx.tenantId, ctx.workspaceId);

    if (!rules.length) return;

    // Filter rules matching this escalation's connector and risk level
    const matchingRules = rules.filter((rule) => {
      if (rule.connector && rule.connector !== ctx.connector) return false;
      if (rule.minRiskLevel) {
        const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
        const ruleLevel = riskOrder[rule.minRiskLevel as keyof typeof riskOrder] ?? 0;
        const escalationLevel = riskOrder[ctx.riskLevel as keyof typeof riskOrder] ?? 0;
        if (escalationLevel < ruleLevel) return false;
      }
      return true;
    });

    if (!matchingRules.length) return;

    // De-duplicate by integration (one notification per integration)
    const seen = new Set<string>();
    const integrations = matchingRules.filter((rule) => {
      if (seen.has(rule.integrationId)) return false;
      seen.add(rule.integrationId);
      return true;
    });

    // Try to query connector and action from runtime_evidence_event if they are missing via repository
    let connector = ctx.connector;
    let action = ctx.action;
    if (!connector || !action) {
      const evRow = await getConnectorActionByDecisionId(ctx.tenantId, ctx.decisionId);
      if (evRow) {
        connector = evRow.connector;
        action = evRow.action;
      }
    }

    const connectorAction = [connector, action].filter(Boolean).join('.');
    const summary = `🚨 New escalation: ${connectorAction || ctx.decisionId} (${ctx.riskLevel} risk)`;
    const details = [
      `**Decision ID**: ${ctx.decisionId}`,
      `**Risk Level**: ${ctx.riskLevel}`,
      `**Reason**: ${ctx.reason}`,
      ctx.consequence ? `**Consequence**: ${ctx.consequence}` : null,
      ctx.dataSensitivity ? `**Data Sensitivity**: ${ctx.dataSensitivity}` : null,
      ctx.toolIntent ? `**Tool Intent**: ${ctx.toolIntent}` : null,
      ctx.planSummary ? `**Plan Summary**: ${ctx.planSummary}` : null,
      `**SLA Due**: ${ctx.slaDueAt}`,
    ].filter(Boolean).join('\n');

    await Promise.allSettled(
      integrations.map((integration) => sendNotification({
        id: integration.integrationId,
        type: integration.type,
        url: integration.url,
        config: integration.config
      }, summary, details, ctx))
    );
  } catch (err) {
    logger.error("[alerting-dispatch] dispatchEscalationCreatedAlert failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function sendPagerDutyNotification(
  integration: AlertingIntegration,
  summary: string,
  ctx: EscalationAlertContext,
  signal: AbortSignal
): Promise<void> {
  const routingKey = (integration.config.routingKey as string | undefined) ?? integration.url;
  const severityMap: Record<string, string> = { CRITICAL: 'critical', HIGH: 'error', MEDIUM: 'warning', LOW: 'info' };
  await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: 'trigger',
      payload: {
        summary: summary,
        source: 'spctre-gateway',
        severity: severityMap[ctx.riskLevel] ?? 'warning',
        custom_details: { decisionId: ctx.decisionId, connector: ctx.connector, riskLevel: ctx.riskLevel },
      },
    }),
    signal,
  });
}

async function sendSplunkHecNotification(
  integration: AlertingIntegration,
  ctx: EscalationAlertContext,
  signal: AbortSignal
): Promise<void> {
  const cfg = integration.config as Record<string, string>;
  const body = JSON.stringify({
    sourcetype: 'spctre:decision',
    source: 'spctre-gateway',
    time: Date.now() / 1000,
    event: {
      event: 'escalation.created',
      decisionId: ctx.decisionId,
      connector: ctx.connector,
      action: ctx.action,
      riskLevel: ctx.riskLevel,
      reason: ctx.reason,
      consequence: ctx.consequence,
      slaDueAt: ctx.slaDueAt,
      timestamp: new Date().toISOString(),
    },
    ...(cfg.index ? { index: cfg.index } : {}),
  });
  await safeFetch(integration.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.token ? { Authorization: `Splunk ${cfg.token}` } : {}),
    },
    body,
    signal,
  });
}

async function sendSentinelNotification(
  integration: AlertingIntegration,
  ctx: EscalationAlertContext,
  signal: AbortSignal
): Promise<void> {
  const cfg = integration.config as Record<string, string>;
  const primaryKey = cfg.primaryKey ?? '';
  const logType = cfg.logType || 'SpctrePolicyEvent';
  const workspaceId = integration.url;
  const body = JSON.stringify([{
    DecisionId: ctx.decisionId,
    Connector: ctx.connector,
    Action: ctx.action,
    RiskLevel: ctx.riskLevel,
    Reason: ctx.reason,
    Consequence: ctx.consequence,
    SlaDueAt: ctx.slaDueAt,
    Timestamp: new Date().toISOString(),
  }]);
  const date = new Date().toUTCString();
  const contentLength = Buffer.byteLength(body, 'utf8');
  const stringToSign = `POST\n${contentLength}\napplication/json\nx-ms-date:${date}\n/api/logs`;
  const keyBytes = Buffer.from(primaryKey, 'base64');
  const signature = createHmac('sha256', keyBytes).update(stringToSign, 'utf8').digest('base64');
  await fetch(
    `https://${workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Log-Type': logType,
        'x-ms-date': date,
        Authorization: `SharedKey ${workspaceId}:${signature}`,
      },
      body,
      signal,
    }
  );
}

async function sendNotification(
  integration: AlertingIntegration,
  summary: string,
  details: string,
  ctx: EscalationAlertContext
): Promise<void> {
  const timeoutMs = 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (integration.type) {
      case 'SLACK': {
        await safeFetch(integration.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: summary,
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: '🚨 Spctre Escalation' } },
              { type: 'section', text: { type: 'mrkdwn', text: details.replace(/\*\*/g, '*') } },
            ],
          }),
          signal: controller.signal,
        });
        break;
      }
      case 'PAGERDUTY': {
        await sendPagerDutyNotification(integration, summary, ctx, controller.signal);
        break;
      }
      case 'TEAMS': {
        await safeFetch(integration.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            '@type': 'MessageCard',
            themeColor: ctx.riskLevel === 'CRITICAL' ? 'FF0000' : ctx.riskLevel === 'HIGH' ? 'FFA500' : '0078D7',
            summary: summary,
            sections: [{ activityTitle: summary, text: details }],
          }),
          signal: controller.signal,
        });
        break;
      }
      case 'EMAIL': {
        await sendAlertEmail({
          to: integration.url,
          subject: summary,
          text: `${summary}\n\n${details.replace(/\*\*/g, "")}`,
        });
        break;
      }
      case 'WEBHOOK': {
        await safeFetch(integration.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'escalation.created',
            decisionId: ctx.decisionId,
            connector: ctx.connector,
            action: ctx.action,
            riskLevel: ctx.riskLevel,
            reason: ctx.reason,
            consequence: ctx.consequence,
            slaDueAt: ctx.slaDueAt,
            toolIntent: ctx.toolIntent,
            planSummary: ctx.planSummary,
            timestamp: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        break;
      }
      case 'SPLUNK_HEC': {
        await sendSplunkHecNotification(integration, ctx, controller.signal);
        break;
      }
      case 'SENTINEL': {
        await sendSentinelNotification(integration, ctx, controller.signal);
        break;
      }
    }
  } catch (err) {
    logger.error(`[alerting-dispatch] Failed to send ${integration.type} notification`, { error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}
