import { createHash, randomUUID } from "crypto";
import { rawSql, sql, runWithTenantContext } from "@/lib/db";

export type HostedPlanCode = "HOSTED_TRIAL" | "TEAM" | "BUSINESS" | "ENTERPRISE";

export const HOSTED_PLAN_CODES: readonly HostedPlanCode[] = [
  "HOSTED_TRIAL",
  "TEAM",
  "BUSINESS",
  "ENTERPRISE",
];

export interface ProvisionedTenant {
  tenantId: string;
  workspaceId: string;
  principalId: string;
}

const OWNER_REVIEWER_ROLES = ["Security", "Platform", "Ops", "Admin"];
const OWNER_PUBLISH_SCOPES = ["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR"];
const OWNER_ENVIRONMENTS = ["development", "staging", "production"];

const DEFAULT_WORKSPACE_SLUG = "default";
const DEFAULT_WORKSPACE_NAME = "Default";

function slugifyTenant(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * The single owner a hosted checkout creates, if it already exists.
 *
 * `app_principal_magic_link_owner_email_idx` makes a magic-link owner email
 * globally unique, which is what makes re-running a checkout idempotent rather
 * than creating a second tenant for the same buyer.
 *
 * Runs on the owner connection: the caller does not know the tenant yet, so
 * there is nothing to bind for the RLS-gated read.
 */
export async function findHostedOwnerByEmail(email: string): Promise<ProvisionedTenant | null> {
  if (!rawSql || !email.trim()) return null;

  const rows = await rawSql<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id
    FROM app_principal
    WHERE lower(email) = lower(${email.trim()})
      AND auth_method = 'MAGIC_LINK'
      AND org_role = 'OWNER'
      AND disabled_at IS NULL
    LIMIT 1
  `;
  const principal = rows[0];
  if (!principal) return null;

  const workspaceRows = await rawSql<{ id: string }[]>`
    SELECT id
    FROM workspace
    WHERE tenant_id = ${principal.tenant_id}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  const workspaceId = workspaceRows[0]?.id;
  if (!workspaceId) return null;

  return { tenantId: principal.tenant_id, workspaceId, principalId: principal.id };
}

async function insertTenant(company: string, email: string): Promise<string | null> {
  if (!rawSql) return null;

  const base = slugifyTenant(company) || "tenant";
  const candidates = [base, `${base}-${shortHash(email)}`, `${base}-${randomUUID().slice(0, 8)}`];

  for (const slug of candidates) {
    // `tenant` is not RLS-gated and the tenant does not exist yet, so this runs
    // on the owner connection. DO NOTHING rather than DO UPDATE: a slug taken
    // by a different buyer must not be silently reassigned.
    const rows = await rawSql<{ id: string }[]>`
      INSERT INTO tenant (slug, name)
      VALUES (${slug}, ${company})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;
    const tenantId = rows[0]?.id;
    if (tenantId) return tenantId;
  }

  return null;
}

/**
 * Create the tenant, commercial profile, workspace, owner principal and grants
 * that a hosted checkout needs.
 *
 * Everything after the tenant row is RLS-gated, so it runs bound to the tenant
 * that was just created.
 */
export async function createHostedTenant(params: {
  email: string;
  displayName: string;
  company: string;
  planCode: HostedPlanCode;
}): Promise<ProvisionedTenant | null> {
  if (!rawSql || !sql) return null;

  const tenantId = await insertTenant(params.company, params.email);
  if (!tenantId) return null;

  return runWithTenantContext(tenantId, async () => {
    await sql`
      INSERT INTO tenant_commercial_profile (
        tenant_id, plan_code, lifecycle_status, sales_status, billing_contact_email
      ) VALUES (
        ${tenantId}, ${params.planCode}, 'ACTIVE', 'CUSTOMER', ${params.email}
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        lifecycle_status = EXCLUDED.lifecycle_status,
        sales_status = EXCLUDED.sales_status,
        billing_contact_email = EXCLUDED.billing_contact_email,
        updated_at = now()
    `;

    const workspaceRows = await sql<{ id: string }[]>`
      INSERT INTO workspace (tenant_id, slug, name)
      VALUES (${tenantId}, ${DEFAULT_WORKSPACE_SLUG}, ${DEFAULT_WORKSPACE_NAME})
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    const workspaceId = workspaceRows[0]?.id;
    if (!workspaceId) return null;

    const principalRows = await sql<{ id: string }[]>`
      INSERT INTO app_principal (
        tenant_id, subject, display_name, email,
        principal_type, auth_method, org_role, invite_status
      ) VALUES (
        ${tenantId}, ${params.email}, ${params.displayName}, ${params.email},
        'USER', 'MAGIC_LINK', 'OWNER', 'ACCEPTED'
      )
      ON CONFLICT (tenant_id, subject) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
    const principalId = principalRows[0]?.id;
    if (!principalId) return null;

    // One org-wide grant and one for the default workspace. The unique
    // constraint on (principal_id, workspace_id) does not cover the org-wide
    // row, because Postgres treats NULL workspace_id values as distinct — so
    // guard both explicitly rather than relying on ON CONFLICT.
    for (const workspaceScope of [null, workspaceId]) {
      await sql`
        INSERT INTO principal_permission_grant (
          tenant_id, principal_id, workspace_id, grant_role,
          reviewer_roles, publish_scopes, allowed_environments
        )
        SELECT
          ${tenantId}, ${principalId}, ${workspaceScope}, 'OWNER',
          ${OWNER_REVIEWER_ROLES}, ${OWNER_PUBLISH_SCOPES}, ${OWNER_ENVIRONMENTS}
        WHERE NOT EXISTS (
          SELECT 1
          FROM principal_permission_grant
          WHERE tenant_id = ${tenantId}
            AND principal_id = ${principalId}
            AND workspace_id IS NOT DISTINCT FROM ${workspaceScope}
        )
      `;
    }

    return { tenantId, workspaceId, principalId };
  });
}
