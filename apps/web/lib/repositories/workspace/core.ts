import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import { swallow } from "@/lib/platform/swallow";

export async function insertAuthorizationDenialEvent(params: {
  tenantId: string;
  action: string;
  reason: string;
  resourceType: string;
  resourceId?: string;
  principalId?: string;
  workspaceId?: string | null;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO authz_denial_event (
      tenant_id, workspace_id, principal_id, action, reason, resource_type, resource_id
    ) VALUES (
      ${params.tenantId},
      ${params.workspaceId ?? null},
      ${params.principalId ?? null},
      ${params.action},
      ${params.reason},
      ${params.resourceType},
      ${params.resourceId ?? null}
    )
  `.catch(swallow("sql", undefined));
}

export async function resolveWorkspaceForAction(params: {
  tenantId: string;
  requestedWorkspaceId?: string;
  fallbackWorkspaceId: string;
}): Promise<{ id: string; slug: string } | null> {
  if (!sql) return null;
  const workspaceId = params.requestedWorkspaceId || params.fallbackWorkspaceId;
  const rows = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug
    FROM workspace
    WHERE id = ${workspaceId}
      AND tenant_id = ${params.tenantId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function verifyWorkspaceSlugForToken(params: {
  tenantId: string;
  workspaceSlug: string;
  workspaceId: string;
}): Promise<{ id: string; tenant_id: string; slug: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string; tenant_id: string; slug: string }[]>`
    SELECT id, tenant_id, slug
    FROM workspace
    WHERE tenant_id = ${params.tenantId}
      AND slug = ${params.workspaceSlug}
      AND id = ${params.workspaceId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function normalizeWorkspaceContext(params: {
  sessionTenantId: string;
  principalSubject: string;
  requestedTenantId: string;
  requestedWorkspaceId: string;
}): Promise<{ tenantId: string; workspaceId: string }> {
  let tenantId = params.sessionTenantId;
  let workspaceId: string = "";

  await ensureDemoTenant().catch(swallow("ensureDemoTenant", undefined));

  if (!sql) return { tenantId: params.sessionTenantId, workspaceId: "" };

  if (params.requestedTenantId) {
    const rows = await sql<{ id: string }[]>`
      SELECT t.id
      FROM tenant t
      JOIN app_principal p ON p.tenant_id = t.id
      WHERE t.id = ${params.requestedTenantId}
        AND p.subject = ${params.principalSubject}
      LIMIT 1
    `;
    if (rows.length) tenantId = rows[0].id;
  }

  if (params.requestedWorkspaceId) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM workspace
      WHERE tenant_id = ${tenantId} AND id = ${params.requestedWorkspaceId}
      LIMIT 1
    `;
    if (rows.length) workspaceId = rows[0].id;
  }

  if (!workspaceId) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM workspace
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (rows.length) workspaceId = rows[0].id;
  }

  return { tenantId, workspaceId };
}

export async function listWorkspacesForTenant(tenantId: string): Promise<{
  id: string;
  slug: string;
  name: string;
  created_at: Date;
}[]> {
  if (!sql) return [];
  return sql<{ id: string; slug: string; name: string; created_at: Date }[]>`
    SELECT id, slug, name, created_at FROM workspace
    WHERE tenant_id = ${tenantId} ORDER BY created_at ASC
  `;
}

export async function listWorkspaceSlugsWithPrefix(params: {
  tenantId: string;
  prefix: string;
}): Promise<string[]> {
  if (!sql) return [];
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM workspace
    WHERE tenant_id = ${params.tenantId} AND slug LIKE ${`${params.prefix}%`}
    ORDER BY slug ASC
  `;
  return rows.map((r) => r.slug);
}

export async function insertWorkspace(params: {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
}): Promise<void> {
  if (!sql) return;
  await sql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${params.id}, ${params.tenantId}, ${params.slug}, ${params.name})`;
}

export async function verifyWorkspaceOwnership(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM workspace WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  return rows.length > 0;
}

export async function checkSlugInUse(params: {
  tenantId: string;
  slug: string;
  excludeWorkspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM workspace
    WHERE tenant_id = ${params.tenantId} AND slug = ${params.slug} AND id <> ${params.excludeWorkspaceId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function updateWorkspaceDetails(params: {
  tenantId: string;
  workspaceId: string;
  name: string;
  slug: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE workspace SET name = ${params.name}, slug = ${params.slug}
    WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId}
  `;
}

export async function countTenantWorkspaces(tenantId: string): Promise<number> {
  if (!sql) return 0;
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM workspace WHERE tenant_id = ${tenantId}
  `;
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

export async function deleteWorkspaceById(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<{ slug: string } | null> {
  if (!sql) return null;
  const targetRows = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM workspace WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  if (!targetRows[0]) return null;
  await sql`DELETE FROM workspace WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId}`;
  return { slug: targetRows[0].slug };
}

export async function getFirstWorkspaceId(tenantId: string): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM workspace WHERE tenant_id = ${tenantId} ORDER BY created_at ASC LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function insertAdminAuditEvent(params: {
  tenantId: string;
  workspaceId?: string | null;
  principalId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: "ALLOWED" | "DENIED";
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO admin_audit_event (
      tenant_id, workspace_id, principal_id, action, target_type, target_id, outcome, reason, metadata
    ) VALUES (
      ${params.tenantId},
      ${params.workspaceId ?? null},
      ${params.principalId ?? null},
      ${params.action},
      ${params.targetType},
      ${params.targetId ?? null},
      ${params.outcome},
      ${params.reason ?? null},
      ${sql.json((params.metadata ?? {}) as JSONValue)}
    )
  `;
}
