import {
  createAlertingIntegration,
  deleteAlertingIntegration,
  createAlertingRule,
  deleteAlertingRule,
  listAlertingIntegrations,
  listAlertingRules,
  type AlertingIntegration,
  type AlertingRule,
} from "@/lib/repositories/alerting";
import { CodedError } from "@/lib/errors/coded-error";
import { getWorkspaceContext, getRequiredWorkspaceContext } from "@/lib/workspace";
import { getAuthSession } from "@/lib/auth-session";
import { validateWebhookUrl, validateSentinelWorkspaceId } from "@/lib/platform/url-guard";

const URL_DISPATCH_TYPES = new Set<string>(["SLACK", "TEAMS", "WEBHOOK", "SPLUNK_HEC"]);

export type { AlertingIntegration, AlertingRule };

export interface AlertingPageModel {
  workspaceContext: Awaited<ReturnType<typeof getWorkspaceContext>>;
  integrations: Awaited<ReturnType<typeof listAlertingIntegrations>>;
  rules: Awaited<ReturnType<typeof listAlertingRules>>;
}

export async function getAlertingPageModel(params: {
  workspaceSlug?: string;
}): Promise<AlertingPageModel> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: params.workspaceSlug });

  const [integrations, rules] = await Promise.all([
    listAlertingIntegrations(workspaceContext.tenantId, workspaceContext.workspaceId),
    listAlertingRules(workspaceContext.tenantId, workspaceContext.workspaceId),
  ]);

  return {
    workspaceContext,
    integrations,
    rules,
  };
}

export async function addAlertingIntegrationDecision(params: {
  workspaceId: string;
  name: string;
  type: "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL";
  url: string;
  config?: Record<string, unknown>;
}) {
  const session = await getAuthSession().catch(() => null);
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");

  if (params.type === "SENTINEL") {
    validateSentinelWorkspaceId(params.url);
  } else if (URL_DISPATCH_TYPES.has(params.type)) {
    validateWebhookUrl(params.url);
  }

  return await createAlertingIntegration(
    session.tenantId,
    params.workspaceId,
    params.name,
    params.type,
    params.url,
    params.config ?? {}
  );
}

export async function removeAlertingIntegrationDecision(params: {
  workspaceId: string;
  id: string;
}) {
  const session = await getAuthSession().catch(() => null);
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");

  return await deleteAlertingIntegration(session.tenantId, params.workspaceId, params.id);
}

export async function addAlertingRuleDecision(params: {
  workspaceId: string;
  name: string;
  enabled: boolean;
  connector: string | null;
  minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  minFrequency: number;
  frequencyWindowMinutes: number | null;
  integrationId: string;
}) {
  const session = await getAuthSession().catch(() => null);
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");

  return await createAlertingRule(
    session.tenantId,
    params.workspaceId,
    params.name,
    params.enabled,
    params.connector,
    params.minRiskLevel,
    params.minFrequency,
    params.frequencyWindowMinutes,
    params.integrationId
  );
}

export async function removeAlertingRuleDecision(params: {
  workspaceId: string;
  id: string;
}) {
  const session = await getAuthSession().catch(() => null);
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");

  return await deleteAlertingRule(session.tenantId, params.workspaceId, params.id);
}
