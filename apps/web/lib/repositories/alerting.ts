import { sql } from "@/lib/db";

export interface AlertingIntegration {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  type: "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL";
  url: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertingRule {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  connector: string | null;
  minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  minFrequency: number;
  frequencyWindowMinutes: number | null;
  integrationId: string;
  integrationName?: string;
  integrationType?: string;
  createdAt: Date;
  updatedAt: Date;
}

function credentialKey(): string {
  return process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY ?? "";
}

export async function listAlertingIntegrations(
  tenantId: string,
  workspaceId: string
): Promise<AlertingIntegration[]> {
  if (!sql) return [];
  return sql<AlertingIntegration[]>`
    SELECT
      id,
      tenant_id AS "tenantId",
      workspace_id AS "workspaceId",
      name,
      type,
      url,
      '{}'::jsonb AS config,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM alerting_integration
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
}

export async function createAlertingIntegration(
  tenantId: string,
  workspaceId: string,
  name: string,
  type: "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL",
  url: string,
  config: Record<string, unknown> = {}
): Promise<AlertingIntegration | null> {
  if (!sql) return null;
  const key = credentialKey();
  if (!key) throw new Error("SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set.");
  const rows = await sql<AlertingIntegration[]>`
    INSERT INTO alerting_integration (
      tenant_id,
      workspace_id,
      name,
      type,
      url,
      config_encrypted
    ) VALUES (
      ${tenantId},
      ${workspaceId},
      ${name},
      ${type},
      ${url},
      pgp_sym_encrypt(${JSON.stringify(config)} /* jsonb-serialization-allow: encrypted text, not a JSONB binding */, ${key})
    )
    RETURNING
      id,
      tenant_id AS "tenantId",
      workspace_id AS "workspaceId",
      name,
      type,
      url,
      pgp_sym_decrypt(config_encrypted, ${key})::jsonb AS config,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  return rows[0] ?? null;
}

export async function deleteAlertingIntegration(
  tenantId: string,
  workspaceId: string,
  id: string
): Promise<boolean> {
  if (!sql) return false;
  const result = await sql`
    DELETE FROM alerting_integration
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND id = ${id}
  `;
  return result.count > 0;
}

export async function listAlertingRules(
  tenantId: string,
  workspaceId: string
): Promise<AlertingRule[]> {
  if (!sql) return [];
  return sql<AlertingRule[]>`
    SELECT
      r.id,
      r.tenant_id AS "tenantId",
      r.workspace_id AS "workspaceId",
      r.name,
      r.enabled,
      r.connector,
      r.min_risk_level AS "minRiskLevel",
      r.min_frequency AS "minFrequency",
      r.frequency_window_minutes AS "frequencyWindowMinutes",
      r.integration_id AS "integrationId",
      i.name AS "integrationName",
      i.type AS "integrationType",
      r.created_at AS "createdAt",
      r.updated_at AS "updatedAt"
    FROM alerting_rule r
    JOIN alerting_integration i ON r.integration_id = i.id
    WHERE r.tenant_id = ${tenantId}
      AND r.workspace_id = ${workspaceId}
    ORDER BY r.created_at DESC
  `;
}

export async function createAlertingRule(
  tenantId: string,
  workspaceId: string,
  name: string,
  enabled: boolean,
  connector: string | null,
  minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null,
  minFrequency: number,
  frequencyWindowMinutes: number | null,
  integrationId: string
): Promise<AlertingRule | null> {
  if (!sql) return null;
  const rows = await sql<AlertingRule[]>`
    INSERT INTO alerting_rule (
      tenant_id,
      workspace_id,
      name,
      enabled,
      connector,
      min_risk_level,
      min_frequency,
      frequency_window_minutes,
      integration_id
    ) VALUES (
      ${tenantId},
      ${workspaceId},
      ${name},
      ${enabled},
      ${connector || null},
      ${minRiskLevel || null},
      ${minFrequency},
      ${frequencyWindowMinutes || null},
      ${integrationId}
    )
    RETURNING
      id,
      tenant_id AS "tenantId",
      workspace_id AS "workspaceId",
      name,
      enabled,
      connector,
      min_risk_level AS "minRiskLevel",
      min_frequency AS "minFrequency",
      frequency_window_minutes AS "frequencyWindowMinutes",
      integration_id AS "integrationId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `;
  return rows[0] ?? null;
}

export async function deleteAlertingRule(
  tenantId: string,
  workspaceId: string,
  id: string
): Promise<boolean> {
  if (!sql) return false;
  const result = await sql`
    DELETE FROM alerting_rule
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND id = ${id}
  `;
  return result.count > 0;
}

export interface EscalationAlertRule {
  id: string;
  connector: string | null;
  minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  integrationId: string;
  type: "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL";
  url: string;
  config: Record<string, unknown>;
}

export async function listActiveAlertingRulesWithIntegrations(
  tenantId: string,
  workspaceId: string
): Promise<EscalationAlertRule[]> {
  if (!sql) return [];
  const key = credentialKey();
  try {
    const rows = await sql<{
      id: string;
      connector: string | null;
      minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
      integrationId: string;
      type: "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL";
      url: string;
      config: Record<string, unknown>;
    }[]>`
      SELECT
        ar.id,
        ar.connector,
        ar.min_risk_level AS "minRiskLevel",
        ar.integration_id AS "integrationId",
        ai.type,
        ai.url,
        pgp_sym_decrypt(ai.config_encrypted, ${key})::jsonb AS config
      FROM alerting_rule ar
      JOIN alerting_integration ai ON ai.id = ar.integration_id
      WHERE ar.tenant_id = ${tenantId}
        AND ar.workspace_id = ${workspaceId}
        AND ar.enabled = true
    `;
    return rows;
  } catch {
    return [];
  }
}
