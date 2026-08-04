import { createHash, randomBytes } from "crypto";
import { rawSql, sql } from "@/lib/db";

export interface ScimTokenRegistration {
  id: string;
  tenantId: string;
  label: string | null;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ResolvedScimTokenAuth {
  tenantId: string;
  registrationId: string;
}

function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateScimToken(): string {
  return `scim_${randomBytes(32).toString("base64url")}`;
}

/** Look up a registration by the raw token value. Returns null on miss or revoked. */
export async function resolveScimTokenBySecret(
  token: string,
): Promise<ResolvedScimTokenAuth | null> {
  const db = rawSql ?? sql;
  if (!db || !token) return null;
  const hash = hashScimToken(token);
  const rows = await db<ResolvedScimTokenAuth[]>`
    UPDATE scim_token_registration
    SET last_used_at = now()
    WHERE token_hash = ${hash}
      AND revoked_at IS NULL
    RETURNING
      id::text        AS "registrationId",
      tenant_id::text AS "tenantId"
  `;
  return rows[0] ?? null;
}

export async function createScimTokenRegistration(params: {
  tenantId: string;
  label?: string;
  createdBy: string;
}): Promise<{ registration: ScimTokenRegistration; token: string }> {
  if (!sql) throw new Error("Database not configured.");
  const token = generateScimToken();
  const hash = hashScimToken(token);
  const rows = await sql<ScimTokenRegistration[]>`
    INSERT INTO scim_token_registration
      (tenant_id, token_hash, label, created_by)
    VALUES
      (${params.tenantId}::uuid, ${hash}, ${params.label ?? null}, ${params.createdBy})
    RETURNING
      id::text,
      tenant_id::text AS "tenantId",
      label,
      created_by AS "createdBy",
      created_at::text AS "createdAt",
      last_used_at::text AS "lastUsedAt"
  `;
  return { registration: rows[0], token };
}

export async function revokeScimTokenRegistration(params: {
  id: string;
  tenantId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const result = await sql`
    UPDATE scim_token_registration
    SET revoked_at = now()
    WHERE id = ${params.id}::uuid
      AND tenant_id = ${params.tenantId}::uuid
      AND revoked_at IS NULL
  `;
  return (result as unknown as { count: number }).count > 0;
}

export async function listScimTokenRegistrations(params: {
  tenantId: string;
}): Promise<ScimTokenRegistration[]> {
  if (!sql) return [];
  return sql<ScimTokenRegistration[]>`
    SELECT
      id::text,
      tenant_id::text AS "tenantId",
      label,
      created_by AS "createdBy",
      created_at::text AS "createdAt",
      last_used_at::text AS "lastUsedAt"
    FROM scim_token_registration
    WHERE tenant_id = ${params.tenantId}::uuid
      AND revoked_at IS NULL
    ORDER BY created_at DESC
  `;
}
