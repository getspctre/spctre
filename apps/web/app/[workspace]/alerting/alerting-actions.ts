"use server";

import { revalidatePath } from "next/cache";
import {
  addAlertingIntegrationDecision,
  removeAlertingIntegrationDecision,
  addAlertingRuleDecision,
  removeAlertingRuleDecision,
} from "@/lib/domains/alerting/service";

export async function addIntegrationAction(
  workspaceId: string,
  workspaceSlug: string,
  name: string,
  type: "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL",
  url: string,
  config: Record<string, unknown> = {}
) {
  const integration = await addAlertingIntegrationDecision({
    workspaceId,
    name,
    type,
    url,
    config,
  });

  revalidatePath(`/${workspaceSlug}/escalation-routing`);
  return integration;
}

export async function removeIntegrationAction(workspaceId: string, workspaceSlug: string, id: string) {
  const success = await removeAlertingIntegrationDecision({ workspaceId, id });
  revalidatePath(`/${workspaceSlug}/escalation-routing`);
  return success;
}

export async function addRuleAction(
  workspaceId: string,
  workspaceSlug: string,
  name: string,
  enabled: boolean,
  connector: string | null,
  minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null,
  minFrequency: number,
  frequencyWindowMinutes: number | null,
  integrationId: string
) {
  const rule = await addAlertingRuleDecision({
    workspaceId,
    name,
    enabled,
    connector,
    minRiskLevel,
    minFrequency,
    frequencyWindowMinutes,
    integrationId,
  });

  revalidatePath(`/${workspaceSlug}/escalation-routing`);
  return rule;
}

export async function removeRuleAction(workspaceId: string, workspaceSlug: string, id: string) {
  const success = await removeAlertingRuleDecision({ workspaceId, id });
  revalidatePath(`/${workspaceSlug}/escalation-routing`);
  return success;
}
