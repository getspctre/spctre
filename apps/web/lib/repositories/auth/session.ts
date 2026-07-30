import { sql } from "@/lib/db";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";

export function isAuthDatabaseConfigured(): boolean {
  return Boolean(sql);
}

export function resolveTenantIdOrDemo(tenantId: string | null | undefined): string {
  const normalized = typeof tenantId === "string" ? tenantId.trim() : "";
  return normalized || "";
}

export function resolveWorkspaceIdOrDemo(workspaceId: string | null | undefined): string | null {
  const normalized = typeof workspaceId === "string" ? workspaceId.trim() : "";
  return normalized || null;
}

export async function ensureAuthDemoTenant(): Promise<void> {
  await ensureDemoTenant();
}

/** @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/) */
export function canBootstrapDemoTenant(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SPCTRE_ENABLE_DEMO_TENANT === "true";
}

export async function getPrimaryWorkspaceIdForTenant(tenantId: string, db = sql): Promise<string | null> {
  if (!db) return null;

  await ensureDemoTenant().catch(() => {
    // non-fatal for lookup below
  });

  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM workspace
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at ASC
    LIMIT 1
  `;

  return rows[0]?.id ?? null;
}

export async function getTenantRequireMfa(tenantId: string): Promise<boolean | null> {
  if (!sql) return null;

  const rows = await sql<{ require_mfa: boolean }[]>`
    SELECT require_mfa
    FROM tenant
    WHERE id = ${tenantId}
    LIMIT 1
  `;

  return rows[0]?.require_mfa ?? false;
}

export async function getPrincipalForLogin(
  principalId: string,
  db = sql
): Promise<{
  id: string;
  tenant_id: string;
  subject: string;
  require_mfa: boolean;
  disabled_at: Date | null;
} | null> {
  if (!db || !principalId) return null;
  const rows = await db<{ id: string; tenant_id: string; subject: string; require_mfa: boolean; disabled_at: Date | null }[]>`
    SELECT p.id, p.tenant_id, p.subject, p.disabled_at, t.require_mfa
    FROM app_principal p
    JOIN tenant t ON t.id = p.tenant_id
    WHERE p.id = ${principalId}
      AND p.principal_type = 'USER'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getTenantPrincipalBySubject(params: {
  tenantId: string;
  subject: string;
}): Promise<{ id: string; principal_id: string; principal_subject: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string; principal_id: string; principal_subject: string }[]>`
    SELECT t.id, p.id AS principal_id, p.subject AS principal_subject
    FROM tenant t
    JOIN app_principal p ON p.tenant_id = t.id
    WHERE t.id = ${params.tenantId}
      AND p.subject = ${params.subject}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function updateSessionForTenantSwitch(params: {
  sessionId: string;
  tenantId: string;
  principalId: string;
  requireMfa: boolean;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE app_session
    SET tenant_id = ${params.tenantId},
        principal_id = ${params.principalId},
        mfa_verified_at = CASE WHEN ${params.requireMfa} THEN NULL ELSE now() END,
        last_seen_at = now()
    WHERE id = ${params.sessionId}
      AND revoked_at IS NULL
  `;
}

export async function updateSessionForActorSwitch(params: {
  sessionId: string;
  tenantId: string;
  principalId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE app_session
    SET principal_id = ${params.principalId}, tenant_id = ${params.tenantId}, last_seen_at = now()
    WHERE id = ${params.sessionId}
      AND revoked_at IS NULL
  `;
}

export async function listPrincipalSessions(params: {
  tenantId: string;
  principalId: string;
}): Promise<{
  id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  user_agent: string | null;
  ip_address: string | null;
}[]> {
  if (!sql) return [];
  return sql<{
    id: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    user_agent: string | null;
    ip_address: string | null;
  }[]>`
    SELECT id, created_at, last_seen_at, expires_at, user_agent, ip_address
    FROM app_session
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND revoked_at IS NULL
      AND expires_at > now()
    ORDER BY last_seen_at DESC
  `;
}

export async function revokeSessionAndRecord(params: {
  sessionId: string;
  tenantId: string;
  principalId: string;
  actorId: string;
  source: import("@spctre/policy-schema").IdentityEventSource;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  if (!sql) return;
  await sql.begin(async (tx) => {
    // 1. Mark session as revoked
    const result = await tx`
      UPDATE app_session
      SET revoked_at = now()
      WHERE id = ${params.sessionId}
        AND tenant_id = ${params.tenantId}
        AND principal_id = ${params.principalId}
        AND revoked_at IS NULL
      RETURNING id, user_agent, ip_address
    `;

    if (!result.length) return;

    const row = result[0];
    const userAgent = params.userAgent ?? (row.user_agent as string | null);
    const ipAddress = params.ipAddress ?? (row.ip_address as string | null);

    // 2. Record the identity lifecycle event
    await tx`
      INSERT INTO agt_identity_lifecycle_event (
        tenant_id,
        principal_id,
        event_type,
        actor_id,
        source,
        detail
      ) VALUES (
        ${params.tenantId},
        ${params.principalId},
        'SESSION_REVOKED',
        ${params.actorId},
        ${params.source},
        ${tx.json({
          sessionId: params.sessionId,
          ipAddress,
          userAgent,
        })}
      )
    `;

    // 3. Append to operations log
    const prevRows = await tx<{ content_hash: string }[]>`
      SELECT content_hash
      FROM agt_operations_log
      WHERE tenant_id = ${params.tenantId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const prevHash = prevRows[0]?.content_hash ?? null;

    const { buildOperationsContentHash } = await import("@spctre/policy-schema");
    const payload = {
      action: "SESSION_REVOKED",
      sessionId: params.sessionId,
      principalId: params.principalId,
      ipAddress,
      userAgent,
    };

    const contentHash = buildOperationsContentHash({
      eventType: "IDENTITY_CHANGE",
      sourceId: params.sessionId,
      sourceTable: "app_session",
      actorId: params.actorId,
      payload,
      prevHash,
    });

    await tx`
      INSERT INTO agt_operations_log (
        tenant_id, event_type, source_id, source_table,
        actor_id, payload, content_hash, prev_hash
      ) VALUES (
        ${params.tenantId}, 'IDENTITY_CHANGE',
        ${params.sessionId}, 'app_session',
        ${params.actorId}, ${tx.json(payload)},
        ${contentHash}, ${prevHash}
      )
    `;
  });
}

export interface AuthSessionDbRow {
  session_id: string;
  tenant_id: string;
  principal_id: string;
  display_name: string;
  email: string | null;
  subject: string;
  auth_method: string;
  mfa_verified_at: Date | null;
  require_mfa: boolean;
}

export async function fetchSessionForAuth(sessionId: string): Promise<AuthSessionDbRow | null> {
  if (!sql) return null;
  const rows = await sql<AuthSessionDbRow[]>`
    SELECT
      s.id AS session_id,
      s.tenant_id,
      s.principal_id,
      p.display_name,
      p.email,
      p.subject,
      s.auth_method,
      s.mfa_verified_at,
      t.require_mfa
    FROM app_session s
    JOIN app_principal p ON p.id = s.principal_id
      AND p.tenant_id = s.tenant_id
    JOIN tenant t ON t.id = s.tenant_id
    WHERE s.id = ${sessionId}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND p.disabled_at IS NULL
      AND p.invite_status <> 'REVOKED'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function updateSessionAndPrincipalActivity(
  sessionId: string,
  principalId: string,
  tenantId: string
): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE app_session
    SET last_seen_at = now()
    WHERE id = ${sessionId}
      AND last_seen_at < now() - interval '5 minutes'
  `;
  await sql`
    UPDATE app_principal
    SET last_active_at = now(),
        invite_status = CASE WHEN invite_status = 'PENDING' THEN 'ACCEPTED' ELSE invite_status END,
        invite_accepted_at = CASE
          WHEN invite_status = 'PENDING' THEN coalesce(invite_accepted_at, now())
          ELSE invite_accepted_at
        END
    WHERE id = ${principalId}
      AND tenant_id = ${tenantId}
  `;
}

export async function createSessionRow(params: {
  principalId: string;
  tenantId: string;
  expiresAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  authMethod: string;
  mfaVerifiedAt?: string | null;
}, db = sql): Promise<string> {
  if (!db) throw new Error("Database not configured.");

  const principalRows = await db<{ id: string }[]>`
    SELECT id
    FROM app_principal
    WHERE id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND disabled_at IS NULL
      AND invite_status <> 'REVOKED'
    LIMIT 1
  `;
  if (!principalRows.length) {
    throw new Error("Principal is not available in the selected tenant.");
  }

  const rows = await db<{ id: string }[]>`
    INSERT INTO app_session (
      tenant_id,
      principal_id,
      expires_at,
      user_agent,
      ip_address,
      auth_method,
      mfa_verified_at
    )
    VALUES (
      ${params.tenantId},
      ${params.principalId},
      ${params.expiresAt},
      ${params.userAgent ?? null},
      ${params.ipAddress ?? null},
      ${params.authMethod},
      ${params.mfaVerifiedAt ?? null}
    )
    RETURNING id
  `;

  return rows[0].id;
}

export async function revokeSessionRow(sessionId: string, tenantId: string): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  await sql`
    UPDATE app_session
    SET revoked_at = now()
    WHERE id = ${sessionId} AND tenant_id = ${tenantId}
  `;
}

export async function listAllLoginPrincipals() {
  if (!sql) return [] as { id: string; tenant_id: string; display_name: string; email: string | null }[];

  await ensureAuthDemoTenant().catch(() => {
    // non-fatal for read-only list
  });

  return sql<
    { id: string; tenant_id: string; display_name: string; email: string | null }[]
  >`
    SELECT id, tenant_id, display_name, email
    FROM app_principal
    WHERE principal_type = 'USER'
      AND disabled_at IS NULL
      AND invite_status <> 'REVOKED'
    ORDER BY created_at ASC
  `;
}
