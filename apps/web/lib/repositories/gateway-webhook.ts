import { createHash, randomBytes } from "crypto";
import { rawSql, runWithTenantContext, sql } from "@/lib/db";

export type WebhookProvider = "portkey" | "helicone" | "litellm" | "notion";

export interface WebhookRegistration {
  id: string;
  tenantId: string;
  workspaceId: string;
  provider: WebhookProvider;
  label: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ResolvedWebhookAuth {
  tenantId: string;
  workspaceId: string;
  provider: WebhookProvider;
  registrationId: string;
}

function hashWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generateWebhookSecret(): string {
  return `gwh_${randomBytes(32).toString("base64url")}`;
}

/** Look up a registration by the raw secret value. Returns null on miss or revoked. */
export async function resolveWebhookRegistrationBySecret(
  secret: string,
): Promise<ResolvedWebhookAuth | null> {
  const db = rawSql ?? sql;
  if (!db || !secret) return null;
  const hash = hashWebhookSecret(secret);
  const rows = await db<ResolvedWebhookAuth[]>`
    SELECT
      id              AS "registrationId",
      tenant_id::text AS "tenantId",
      workspace_id::text AS "workspaceId",
      provider
    FROM gateway_webhook_registration
    WHERE secret_hash = ${hash}
      AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function createWebhookRegistration(params: {
  tenantId: string;
  workspaceId: string;
  provider: WebhookProvider;
  label?: string;
  createdBy: string;
}): Promise<{ registration: WebhookRegistration; secret: string }> {
  if (!sql) throw new Error("Database not configured.");
  const secret = generateWebhookSecret();
  const hash = hashWebhookSecret(secret);
  const rows = await sql<WebhookRegistration[]>`
    INSERT INTO gateway_webhook_registration
      (tenant_id, workspace_id, provider, secret_hash, label, created_by)
    VALUES
      (${params.tenantId}::uuid, ${params.workspaceId}::uuid,
       ${params.provider}, ${hash}, ${params.label ?? null}, ${params.createdBy})
    RETURNING
      id::text,
      tenant_id::text AS "tenantId",
      workspace_id::text AS "workspaceId",
      provider,
      label,
      created_by AS "createdBy",
      created_at::text AS "createdAt"
  `;
  return { registration: rows[0], secret };
}

export async function revokeWebhookRegistration(params: {
  id: string;
  tenantId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const result = await sql`
    UPDATE gateway_webhook_registration
    SET revoked_at = now()
    WHERE id = ${params.id}::uuid
      AND tenant_id = ${params.tenantId}::uuid
      AND workspace_id = ${params.workspaceId}::uuid
      AND revoked_at IS NULL
  `;
  return (result as unknown as { count: number }).count > 0;
}

export async function listWebhookRegistrations(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<WebhookRegistration[]> {
  if (!sql) return [];
  return sql<WebhookRegistration[]>`
    SELECT
      id::text,
      tenant_id::text AS "tenantId",
      workspace_id::text AS "workspaceId",
      provider,
      label,
      created_by AS "createdBy",
      created_at::text AS "createdAt"
    FROM gateway_webhook_registration
    WHERE tenant_id = ${params.tenantId}::uuid
      AND workspace_id = ${params.workspaceId}::uuid
      AND revoked_at IS NULL
    ORDER BY created_at DESC
  `;
}

/**
 * Persist a webhook event ID for replay detection. Returns false if the event
 * was already seen (i.e. this is a replay).
 */
export async function recordWebhookEventForReplayCheck(params: {
  eventId: string;
  tenantId: string;
  provider: WebhookProvider;
}): Promise<boolean> {
  if (!sql) return true;
  return runWithTenantContext(params.tenantId, async () => {
    const result = await sql`
      INSERT INTO gateway_webhook_replay_check (event_id, tenant_id, provider)
      VALUES (${params.eventId}, ${params.tenantId}::uuid, ${params.provider})
      ON CONFLICT DO NOTHING
    `;
    return (result as unknown as { count: number }).count > 0;
  });
}
