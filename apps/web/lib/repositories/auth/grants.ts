import { sql } from "@/lib/db";

/** @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/) */
export async function ensurePrincipalGrantAndCheckAccess(params: {
  tenantId: string;
  principalId: string;
}): Promise<boolean> {
  if (!sql) return false;

  const grants = await sql<{ reviewer_roles: string[] | null; publish_scopes: string[] | null }[]>`
    SELECT reviewer_roles, publish_scopes
    FROM principal_permission_grant
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
    LIMIT 1
  `;

  const hasAccess = grants.some(
    (g) => Boolean(g.reviewer_roles?.length || g.publish_scopes?.length)
  );

  if (!grants.length) {
    await sql`
      INSERT INTO principal_permission_grant (
        tenant_id, principal_id, workspace_id,
        reviewer_roles, publish_scopes, allowed_environments
      ) VALUES (
        ${params.tenantId}, ${params.principalId}, null,
        ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]
      )
    `;
  }

  return hasAccess;
}

export async function ensurePrincipalPermissionGrant(params: {
  tenantId: string;
  principalId: string;
}): Promise<"ok" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  const grants = await sql<{ principal_id: string }[]>`
    SELECT principal_id
    FROM principal_permission_grant
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
    LIMIT 1
  `;

  if (!grants.length) {
    await sql`
      INSERT INTO principal_permission_grant (
        tenant_id,
        principal_id,
        workspace_id,
        reviewer_roles,
        publish_scopes,
        allowed_environments
      ) VALUES (
        ${params.tenantId},
        ${params.principalId},
        null,
        ARRAY[]::text[],
        ARRAY[]::text[],
        ARRAY[]::text[]
      )
    `;
  }

  return "ok";
}

export async function upsertLocalDevWorkspaceGrant(params: {
  tenantId: string;
  principalId: string;
  workspaceId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO principal_permission_grant (
      tenant_id, principal_id, workspace_id,
      grant_role, reviewer_roles, publish_scopes, allowed_environments
    ) VALUES (
      ${params.tenantId},
      ${params.principalId},
      ${params.workspaceId},
      'OWNER',
      ARRAY['Admin','Ops','Security','Platform']::text[],
      ARRAY['ORGANIZATION','WORKSPACE','ENVIRONMENT','CONNECTOR']::text[],
      ARRAY['development','staging','production','incident-mode']::text[]
    )
    ON CONFLICT (principal_id, workspace_id)
    DO UPDATE SET
      grant_role = EXCLUDED.grant_role,
      reviewer_roles = EXCLUDED.reviewer_roles,
      publish_scopes = EXCLUDED.publish_scopes,
      allowed_environments = EXCLUDED.allowed_environments
  `;
}
