/**
 * Which features a tenant is entitled to, as opposed to which features the
 * deployment is licensed to run.
 *
 * Two independent facts decide this, and both are needed:
 *
 *   1. `SPCTRE_PLAN` — what this *deployment* may run. It is the open-core
 *      boundary: whether the commercial overlay loads at all. It belongs in the
 *      environment because it is a property of the install, not of a customer,
 *      and a self-hosted operator must not be able to grant themselves SAML by
 *      writing a database row.
 *
 *   2. The tenant's plan code — what this *customer* bought. It lives in the
 *      database because it changes when they pay, upgrade, or churn.
 *
 * Reading only the first is what this module exists to stop. On a hosted
 * deployment the environment plan is necessarily the highest plan the operator
 * sells, so treating it as every tenant's entitlement gives a free trial the
 * complete catalog and makes a downgrade purely cosmetic.
 *
 * The entitlement is therefore the *lower* of the two: the deployment plan is a
 * ceiling that a purchase cannot exceed, and the purchased tier is a grant that
 * the deployment must already be licensed to honor.
 *
 * ## Self-hosted commercial installs
 *
 * A licensed self-hosted deployment has no billing relationship with itself and
 * so has no commercial profile row. It must not be clamped to the trial tier
 * that a missing row otherwise implies, so a tenant with no plan code on record
 * receives the deployment plan whole. `singleTenantMode` reaches the same
 * conclusion earlier, for a deployment that has declared it serves one tenant.
 *
 * ## Failure
 *
 * An unreadable plan code denies. Granting on failure is unrecoverable — an
 * archive written or a compliance packet exported cannot be withdrawn once a
 * transient error has passed — while denying is a retry. The narrow read this
 * uses hits the same database the surrounding request already depends on, so
 * the blast radius of that choice is a request that was failing regardless.
 */
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  FEATURE_FLAGS,
  getFeatureFlagSnapshot,
  isFeatureEnabledForPlan,
  lowerPlanOf,
  type FeatureFlag,
  type FeatureFlagSnapshot,
  type SpctrePlan,
} from "@/lib/feature-flags";
import { resolvePlanEntitlements } from "@/lib/ee-adapters/entitlement-catalog";
import { getTenantPlanCodeWithContext } from "@/lib/repositories/workspace/commercial";
import { logger } from "@spctre/platform/logging";

/**
 * The plan this tenant's entitlements resolve to, already intersected with the
 * deployment ceiling. Exported for surfaces that need the tier itself — an
 * upgrade prompt naming the plan a feature needs, for instance — rather than a
 * yes/no on one flag.
 */
export async function resolveTenantPlan(tenantId: string | null): Promise<SpctrePlan> {
  const { plan, singleTenantMode } = getRuntimeConfig();

  // Nothing commercial is loaded, so no tenant can be entitled to it. Checked
  // first because it makes the database read below pointless.
  if (plan === "oss") return "oss";

  // A deployment that serves exactly one tenant is that tenant. Its plan is the
  // licence it installed under, not a SKU it bought from itself.
  if (singleTenantMode) return plan;

  if (!tenantId) return "oss";

  const planCode = await getTenantPlanCodeWithContext(tenantId);

  // No commercial profile: a licensed self-hosted install, which is entitled to
  // what it installed. See the module docblock — this is the case that makes
  // `getCommercialProfile`'s HOSTED_TRIAL default unusable here.
  if (planCode === null) return plan;

  const { tier } = await resolvePlanEntitlements(planCode);
  return lowerPlanOf(plan, tier);
}

/** Whether one feature is entitled for this tenant. */
export async function isFeatureEntitled(
  flag: FeatureFlag,
  tenantId: string | null,
): Promise<boolean> {
  try {
    return isFeatureEnabledForPlan(flag, await resolveTenantPlan(tenantId));
  } catch (err) {
    logger.error("Failed to resolve tenant entitlement; denying the feature.", {
      flag,
      minimumPlan: FEATURE_FLAGS[flag].minimumPlan,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Every flag for this tenant, from one plan resolution.
 *
 * A surface deciding several features at once must use this rather than calling
 * {@link isFeatureEntitled} per flag: the per-flag path reads the plan code each
 * time, and a page gating on four features would issue four identical queries.
 */
export async function getEntitledFeatureFlags(
  tenantId: string | null,
): Promise<FeatureFlagSnapshot> {
  try {
    return getFeatureFlagSnapshot(await resolveTenantPlan(tenantId));
  } catch (err) {
    logger.error("Failed to resolve tenant entitlements; denying every feature.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return getFeatureFlagSnapshot("oss");
  }
}
