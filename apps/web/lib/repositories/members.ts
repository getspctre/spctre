import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";
import {
  ORG_ROLES,
  ROLE_DEFINITIONS,
  inferRoleFromGrant,
  isOrgRole,
  roleDefinition,
  type OrgRole,
} from "@/lib/rbac";

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
}

interface MemberGrantSummary {
  id: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
  workspaceName: string | null;
  role: OrgRole;
  reviewerRoles: string[];
  publishScopes: string[];
  allowedEnvironments: string[];
}

export interface OrganizationMember {
  id: string;
  displayName: string;
  email: string | null;
  subject: string;
  orgRole: OrgRole;
  inviteStatus: "PENDING" | "ACCEPTED" | "REVOKED";
  authMethod: string;
  createdAt: string;
  invitedAt: string | null;
  inviteAcceptedAt: string | null;
  disabledAt: string | null;
  lastActiveAt: string | null;
  mfaEnrolled: boolean;
  passkeyCount: number;
  grants: MemberGrantSummary[];
}

export interface RbacAuditEvent {
  id: string;
  workspaceId: string | null;
  actorId: string | null;
  targetPrincipalId: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export function normalizeOrgRole(value: string | null | undefined): OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value ?? "") ? (value as OrgRole) : "VIEWER";
}

export function grantForRole(role: OrgRole) {
  const definition = ROLE_DEFINITIONS[role];
  return {
    reviewerRoles: definition.reviewerRoles,
    publishScopes: definition.publishScopes,
    allowedEnvironments: definition.allowedEnvironments,
  };
}

export async function listTenantWorkspaces(tenantId: string): Promise<WorkspaceSummary[]> {
  if (!sql) return [];
  const rows = await sql<{ id: string; slug: string; name: string }[]>`
    SELECT id, slug, name
    FROM workspace
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at ASC
  `;
  return rows;
}

export async function listOrganizationMembers(tenantId: string): Promise<OrganizationMember[]> {
  if (!sql) return [];

  const [principalRows, grantRows] = await Promise.all([
    sql<{
      id: string;
      display_name: string;
      email: string | null;
      subject: string;
      org_role: string | null;
      invite_status: "PENDING" | "ACCEPTED" | "REVOKED";
      auth_method: string | null;
      created_at: Date;
      invited_at: Date | null;
      invite_accepted_at: Date | null;
      disabled_at: Date | null;
      last_active_at: Date | null;
      session_last_seen_at: Date | null;
      passkey_count: number;
      mfa_count: number;
    }[]>`
      SELECT
        p.id,
        p.display_name,
        p.email,
        p.subject,
        p.org_role,
        p.invite_status,
        p.auth_method,
        p.created_at,
        p.invited_at,
        p.invite_accepted_at,
        p.disabled_at,
        p.last_active_at,
        MAX(s.last_seen_at) AS session_last_seen_at,
        COUNT(DISTINCT pk.id)::int AS passkey_count,
        COUNT(DISTINCT mfa.id)::int AS mfa_count
      FROM app_principal p
      LEFT JOIN app_session s ON s.principal_id = p.id AND s.tenant_id = p.tenant_id
      LEFT JOIN passkey pk ON pk.principal_id = p.id AND pk.tenant_id = p.tenant_id
      LEFT JOIN mfa_enrollment mfa ON mfa.principal_id = p.id AND mfa.tenant_id = p.tenant_id AND mfa.verified_at IS NOT NULL
      WHERE p.tenant_id = ${tenantId}
        AND p.principal_type = 'USER'
        AND p.disabled_at IS NULL
      GROUP BY p.id, p.display_name, p.email, p.subject, p.org_role, p.invite_status,
        p.auth_method, p.created_at, p.invited_at, p.invite_accepted_at, p.disabled_at, p.last_active_at
      ORDER BY p.created_at ASC
    `,
    sql<{
      id: string;
      principal_id: string;
      workspace_id: string | null;
      workspace_slug: string | null;
      workspace_name: string | null;
      grant_role: string | null;
      reviewer_roles: string[];
      publish_scopes: string[];
      allowed_environments: string[];
    }[]>`
      SELECT
        g.id,
        g.principal_id,
        g.workspace_id,
        w.slug AS workspace_slug,
        w.name AS workspace_name,
        g.grant_role,
        g.reviewer_roles,
        g.publish_scopes,
        g.allowed_environments
      FROM principal_permission_grant g
      LEFT JOIN workspace w ON w.id = g.workspace_id AND w.tenant_id = g.tenant_id
      WHERE g.tenant_id = ${tenantId}
      ORDER BY g.created_at ASC
    `
  ]);

  const grantsByPrincipal = new Map<string, MemberGrantSummary[]>();
  for (const row of grantRows) {
    const role = inferRoleFromGrant({
      grantRole: row.grant_role,
      reviewerRoles: row.reviewer_roles,
      publishScopes: row.publish_scopes,
    });
    const grants = grantsByPrincipal.get(row.principal_id) ?? [];
    grants.push({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceSlug: row.workspace_slug,
      workspaceName: row.workspace_name,
      role,
      reviewerRoles: row.reviewer_roles ?? [],
      publishScopes: row.publish_scopes ?? [],
      allowedEnvironments: row.allowed_environments ?? [],
    });
    grantsByPrincipal.set(row.principal_id, grants);
  }

  return principalRows.map((row) => {
    const orgRole = normalizeOrgRole(row.org_role);
    const lastActive = row.last_active_at ?? row.session_last_seen_at;
    return {
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      subject: row.subject,
      orgRole,
      inviteStatus: row.invite_status,
      authMethod: row.auth_method ?? "SESSION",
      createdAt: row.created_at.toISOString(),
      invitedAt: row.invited_at?.toISOString() ?? null,
      inviteAcceptedAt: row.invite_accepted_at?.toISOString() ?? null,
      disabledAt: row.disabled_at?.toISOString() ?? null,
      lastActiveAt: lastActive?.toISOString() ?? null,
      mfaEnrolled: row.mfa_count > 0,
      passkeyCount: row.passkey_count,
      grants: grantsByPrincipal.get(row.id) ?? [{
        id: "derived-org-role",
        workspaceId: null,
        workspaceSlug: null,
        workspaceName: null,
        role: orgRole,
        reviewerRoles: roleDefinition(orgRole).reviewerRoles,
        publishScopes: roleDefinition(orgRole).publishScopes,
        allowedEnvironments: roleDefinition(orgRole).allowedEnvironments,
      }],
    };
  });
}

export async function listRecentRbacAuditEvents(
  tenantId: string,
  limit = 20
): Promise<RbacAuditEvent[]> {
  if (!sql) return [];
  const rows = await sql<{
    id: string;
    workspace_id: string | null;
    actor_id: string | null;
    target_principal_id: string | null;
    action: string;
    detail: unknown;
    created_at: Date;
  }[]>`
    SELECT id, workspace_id, actor_id, target_principal_id, action, detail, created_at
    FROM rbac_audit_event
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    targetPrincipalId: row.target_principal_id,
    action: row.action,
    detail: row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : {},
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getActorOrgRole(params: {
  tenantId: string;
  principalId: string;
}): Promise<OrgRole> {
  if (!sql) return "ADMIN" as const;
  const rows = await sql<{ org_role: string }[]>`
    SELECT org_role FROM app_principal
    WHERE id = ${params.principalId} AND tenant_id = ${params.tenantId} AND disabled_at IS NULL
    LIMIT 1
  `;
  return isOrgRole(rows[0]?.org_role ?? "") ? rows[0].org_role as OrgRole : "ADMIN" as const;
}

export async function getPrincipalBySubject(params: {
  tenantId: string;
  subject: string;
}): Promise<{ org_role: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ org_role: string }[]>`
    SELECT org_role FROM app_principal
    WHERE tenant_id = ${params.tenantId} AND subject = ${params.subject}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getPrincipalOrgRole(params: {
  tenantId: string;
  principalId: string;
}): Promise<{ org_role: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ org_role: string }[]>`
    SELECT org_role FROM app_principal
    WHERE id = ${params.principalId} AND tenant_id = ${params.tenantId} AND disabled_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function verifyWorkspaceAccess(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM workspace
    WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function auditRbacAndLifecycle(params: {
  tenantId: string;
  workspaceId?: string | null;
  actorId: string;
  targetPrincipalId?: string | null;
  action: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO rbac_audit_event (
      tenant_id, workspace_id, actor_id, target_principal_id, action, detail
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId ?? null}, ${params.actorId},
      ${params.targetPrincipalId ?? null}, ${params.action}, ${sql.json(params.detail as JSONValue)}::jsonb
    )
  `;
  if (params.targetPrincipalId) {
    await sql`
      INSERT INTO agt_identity_lifecycle_event (
        tenant_id, workspace_id, principal_id, event_type, actor_id, source, detail
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId ?? null}, ${params.targetPrincipalId},
        ${params.action === "MEMBER_REMOVED" ? "ROLE_REVOKED" : "ROLE_GRANTED"},
        ${params.actorId}, 'ADMIN', ${sql.json(params.detail as JSONValue)}::jsonb
      )
    `;
  }
}

export async function upsertPrincipalGrant(params: {
  tenantId: string;
  principalId: string;
  workspaceId: string | null;
  role: OrgRole;
}): Promise<void> {
  if (!sql) return;
  const grant = grantForRole(params.role);
  if (params.workspaceId) {
    await sql`
      INSERT INTO principal_permission_grant (
        tenant_id, principal_id, workspace_id, grant_role,
        reviewer_roles, publish_scopes, allowed_environments
      ) VALUES (
        ${params.tenantId}, ${params.principalId}, ${params.workspaceId}, ${params.role},
        ${grant.reviewerRoles}, ${grant.publishScopes}, ${grant.allowedEnvironments}
      )
      ON CONFLICT (principal_id, workspace_id) DO UPDATE SET
        grant_role = EXCLUDED.grant_role,
        reviewer_roles = EXCLUDED.reviewer_roles,
        publish_scopes = EXCLUDED.publish_scopes,
        allowed_environments = EXCLUDED.allowed_environments
    `;
    return;
  }
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM principal_permission_grant
    WHERE tenant_id = ${params.tenantId} AND principal_id = ${params.principalId} AND workspace_id IS NULL
    ORDER BY created_at ASC LIMIT 1
  `;
  if (existing[0]?.id) {
    await sql`
      UPDATE principal_permission_grant
      SET grant_role = ${params.role}, reviewer_roles = ${grant.reviewerRoles},
          publish_scopes = ${grant.publishScopes}, allowed_environments = ${grant.allowedEnvironments}
      WHERE id = ${existing[0].id} AND tenant_id = ${params.tenantId}
    `;
  } else {
    await sql`
      INSERT INTO principal_permission_grant (
        tenant_id, principal_id, workspace_id, grant_role,
        reviewer_roles, publish_scopes, allowed_environments
      ) VALUES (
        ${params.tenantId}, ${params.principalId}, null, ${params.role},
        ${grant.reviewerRoles}, ${grant.publishScopes}, ${grant.allowedEnvironments}
      )
    `;
  }
}

export async function upsertOrganizationInvite(params: {
  tenantId: string;
  subject: string;
  displayName: string;
  email: string;
  orgRole: OrgRole;
  invitedBy: string;
}): Promise<{ id: string; created: boolean } | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string; created: boolean }[]>`
    INSERT INTO app_principal (
      tenant_id, subject, display_name, email, principal_type,
      auth_method, org_role, invite_status, invited_by, invited_at, disabled_at
    ) VALUES (
      ${params.tenantId}, ${params.subject}, ${params.displayName}, ${params.email}, 'USER',
      'INVITED', ${params.orgRole}, 'PENDING', ${params.invitedBy}, now(), null
    )
    ON CONFLICT (tenant_id, subject) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      org_role = EXCLUDED.org_role,
      invite_status = CASE
        WHEN app_principal.invite_status = 'REVOKED' THEN 'PENDING'
        ELSE app_principal.invite_status
      END,
      invited_by = EXCLUDED.invited_by,
      invited_at = COALESCE(app_principal.invited_at, EXCLUDED.invited_at),
      disabled_at = null
    RETURNING id, (xmax = 0) AS created
  `;
  return rows[0] ?? null;
}

export async function updatePrincipalOrgRole(params: {
  tenantId: string;
  principalId: string;
  orgRole: OrgRole;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE app_principal
    SET org_role = ${params.orgRole}
    WHERE id = ${params.principalId} AND tenant_id = ${params.tenantId}
      AND principal_type = 'USER' AND disabled_at IS NULL
  `;
}

export async function deletePrincipalWorkspaceGrant(params: {
  tenantId: string;
  principalId: string;
  workspaceId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    DELETE FROM principal_permission_grant
    WHERE tenant_id = ${params.tenantId} AND principal_id = ${params.principalId}
      AND workspace_id = ${params.workspaceId}
  `;
}

export async function revokeInvite(params: {
  tenantId: string;
  principalId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE app_principal
    SET invite_status = 'REVOKED', invite_revoked_at = now(), disabled_at = now()
    WHERE id = ${params.principalId} AND tenant_id = ${params.tenantId}
      AND invite_status = 'PENDING'
  `;
  await sql`
    DELETE FROM principal_permission_grant
    WHERE tenant_id = ${params.tenantId} AND principal_id = ${params.principalId}
  `;
}

export async function removeOrganizationMember(params: {
  tenantId: string;
  principalId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE app_principal
    SET disabled_at = now(), invite_status = 'REVOKED',
        invite_revoked_at = coalesce(invite_revoked_at, now())
    WHERE id = ${params.principalId} AND tenant_id = ${params.tenantId}
      AND principal_type = 'USER'
  `;
  await sql`
    DELETE FROM principal_permission_grant
    WHERE tenant_id = ${params.tenantId} AND principal_id = ${params.principalId}
  `;
  await sql`
    UPDATE app_session SET revoked_at = now()
    WHERE tenant_id = ${params.tenantId} AND principal_id = ${params.principalId}
      AND revoked_at IS NULL
  `;
}
