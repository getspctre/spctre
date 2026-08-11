import { createHash, randomUUID } from "crypto";
import { rawSql, sql, runWithTenantContext } from "@/lib/db";

export type HostedPlanCode = "HOSTED_TRIAL" | "TEAM" | "BUSINESS" | "ENTERPRISE";

export const HOSTED_PLAN_CODES: readonly HostedPlanCode[] = [
  "HOSTED_TRIAL",
  "TEAM",
  "BUSINESS",
  "ENTERPRISE",
];

export type HostedLifecycleStatus = "EVALUATING" | "ACTIVE" | "EXPANDING" | "PAUSED";

export const HOSTED_LIFECYCLE_STATUSES: readonly HostedLifecycleStatus[] = [
  "EVALUATING",
  "ACTIVE",
  "EXPANDING",
  "PAUSED",
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

const OWNER_EMAIL_UNIQUE_INDEX = "app_principal_magic_link_owner_email_idx";

function isOwnerEmailConflict(error: unknown): boolean {
  const candidate = error as { code?: string; constraint_name?: string } | null;
  return (
    candidate?.code === "23505" &&
    (candidate.constraint_name === OWNER_EMAIL_UNIQUE_INDEX ||
      String(error).includes(OWNER_EMAIL_UNIQUE_INDEX))
  );
}

/**
 * Undo a tenant row whose dependent writes did not land.
 *
 * The tenant is created on the owner connection before any tenant context
 * exists, so it cannot join the transaction that writes everything else. When
 * that transaction rolls back, the tenant row is the one thing left behind.
 */
async function deleteAbandonedTenant(tenantId: string): Promise<void> {
  if (!rawSql) return;
  await rawSql`DELETE FROM tenant WHERE id = ${tenantId}`;
}

export type CreateHostedTenantOutcome =
  | { status: "created"; tenant: ProvisionedTenant }
  // Another caller created the same owner between our check and our insert.
  | { status: "conflict" }
  | { status: "failed" };

/**
 * Create the tenant, commercial profile, workspace, owner principal and grants
 * that a hosted checkout needs.
 *
 * Everything after the tenant row is RLS-gated, so it runs bound to the tenant
 * that was just created, and inside one transaction: a subscription webhook
 * arrives alongside its siblings, and a loser that had already written a
 * profile and a workspace would leave an ownerless tenant behind.
 */
export async function createHostedTenant(params: {
  email: string;
  displayName: string;
  company: string;
  planCode: HostedPlanCode;
  lifecycleStatus: HostedLifecycleStatus;
  billingCustomerId: string | null;
}): Promise<CreateHostedTenantOutcome> {
  if (!rawSql || !sql) return { status: "failed" };

  const tenantId = await insertTenant(params.company, params.email);
  if (!tenantId) return { status: "failed" };

  try {
    const tenant = await runWithTenantContext(tenantId, () =>
      writeTenantDependents(tenantId, params),
    );
    if (!tenant) {
      await deleteAbandonedTenant(tenantId);
      return { status: "failed" };
    }
    return { status: "created", tenant };
  } catch (error) {
    await deleteAbandonedTenant(tenantId);
    if (isOwnerEmailConflict(error)) return { status: "conflict" };
    throw error;
  }
}

async function writeTenantDependents(
  tenantId: string,
  params: {
    email: string;
    displayName: string;
    company: string;
    planCode: HostedPlanCode;
    lifecycleStatus: HostedLifecycleStatus;
    billingCustomerId: string | null;
  },
): Promise<ProvisionedTenant | null> {
  return sql!.begin(async (tx) => {
    // billing_provider defaults to 'PADDLE'; billing_customer_id is supplied
    // when the caller already knows it (subscription webhooks) and left null
    // when it does not (checkout before the subscription exists).
    await tx`
      INSERT INTO tenant_commercial_profile (
        tenant_id, plan_code, lifecycle_status, sales_status,
        billing_contact_email, billing_customer_id
      ) VALUES (
        ${tenantId}, ${params.planCode}, ${params.lifecycleStatus}, 'CUSTOMER',
        ${params.email}, ${params.billingCustomerId}
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        lifecycle_status = EXCLUDED.lifecycle_status,
        sales_status = EXCLUDED.sales_status,
        billing_contact_email = EXCLUDED.billing_contact_email,
        billing_customer_id = COALESCE(
          EXCLUDED.billing_customer_id,
          tenant_commercial_profile.billing_customer_id
        ),
        updated_at = now()
    `;

    const workspaceRows = await tx<{ id: string }[]>`
      INSERT INTO workspace (tenant_id, slug, name)
      VALUES (${tenantId}, ${DEFAULT_WORKSPACE_SLUG}, ${DEFAULT_WORKSPACE_NAME})
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    const workspaceId = workspaceRows[0]?.id;
    if (!workspaceId) return null;

    const principalRows = await tx<{ id: string }[]>`
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
      await tx`
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
