import { ensureDefaultPublishedPolicyPack } from "@/lib/repositories/default-policy";
import {
  createHostedTenant,
  findHostedOwnerByEmail,
  HOSTED_LIFECYCLE_STATUSES,
  HOSTED_PLAN_CODES,
  type HostedLifecycleStatus,
  type HostedPlanCode,
  type ProvisionedTenant,
} from "@/lib/repositories/provisioning";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import { runWithTenantContext } from "@/lib/tenant-context";

export type ProvisionHostedTenantResult =
  | ({ ok: true; created: boolean } & ProvisionedTenant)
  | { error: "database_required" | "invalid_request" | "create_failed" };

function normalizePlan(plan: string | undefined): HostedPlanCode {
  const candidate = plan?.trim().toUpperCase();
  return HOSTED_PLAN_CODES.includes(candidate as HostedPlanCode)
    ? (candidate as HostedPlanCode)
    : "TEAM";
}

function normalizeLifecycleStatus(status: string | undefined): HostedLifecycleStatus {
  const candidate = status?.trim().toUpperCase();
  return HOSTED_LIFECYCLE_STATUSES.includes(candidate as HostedLifecycleStatus)
    ? (candidate as HostedLifecycleStatus)
    : "ACTIVE";
}

/**
 * Create the tenant a hosted checkout just paid for, and give its workspace a
 * published baseline policy.
 *
 * Checkout previously wrote these rows itself, which left the control plane
 * unaware that a workspace had been created — so nothing seeded a policy for
 * it and the workspace stayed empty until someone created a second workspace
 * in-app. Owning creation here keeps the baseline attached to the moment a
 * workspace comes into existence.
 *
 * Idempotent: re-running a checkout for an email that already owns a tenant
 * returns that tenant rather than creating a second one.
 */
export async function provisionHostedTenant(params: {
  email: string;
  displayName: string;
  company?: string;
  plan?: string;
  lifecycleStatus?: string;
  billingCustomerId?: string;
}): Promise<ProvisionHostedTenantResult> {
  if (!isDatabaseConfigured()) return { error: "database_required" };

  const email = params.email?.trim().toLowerCase() ?? "";
  const displayName = params.displayName?.trim() ?? "";
  if (!email || !email.includes("@") || !displayName) return { error: "invalid_request" };

  const existing = await findHostedOwnerByEmail(email);
  if (existing) return { ok: true, created: false, ...existing };

  const company = params.company?.trim() || `${displayName}'s Org`;
  const outcome = await createHostedTenant({
    email,
    displayName,
    company,
    planCode: normalizePlan(params.plan),
    lifecycleStatus: normalizeLifecycleStatus(params.lifecycleStatus),
    billingCustomerId: params.billingCustomerId?.trim() || null,
  });

  // A subscription webhook arrives alongside its siblings, so several callers
  // can pass the existence check above before any of them commits. The unique
  // owner-email index decides who wins; the losers resolve to that tenant
  // rather than failing, which is what the check was trying to express.
  if (outcome.status === "conflict") {
    const winner = await findHostedOwnerByEmail(email);
    return winner ? { ok: true, created: false, ...winner } : { error: "create_failed" };
  }
  if (outcome.status === "failed") return { error: "create_failed" };

  const provisioned = outcome.tenant;

  await runWithTenantContext(provisioned.tenantId, () =>
    ensureDefaultPublishedPolicyPack({
      tenantId: provisioned.tenantId,
      workspaceId: provisioned.workspaceId,
      actorId: provisioned.principalId,
    }),
  );

  return { ok: true, created: true, ...provisioned };
}
