// OSS slot adapter — resolved dynamically or replaced during commercial builds.
//
// What a paid plan includes is a commercial packaging decision: it belongs to
// whoever sells the plan, it changes on a commercial cadence, and no part of it
// describes how the product behaves. The contract and the enforcement-state
// semantics live in `@/lib/entitlements/catalog`; the numbers come from here.
//
// The OSS fallback is the unmetered catalog, not an error. A self-hosted
// deployment is not a caller reaching for a premium capability — it is the
// normal case, and it is entitled to run with nothing capped and nothing
// pruned. Enforcement paths must therefore treat "no catalog" as "no limit",
// which is exactly what an unenforced entitlement already means.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import {
  OSS_ENTITLEMENT_CATALOG,
  COMMERCIAL_PLAN_CODES,
  type EntitlementCatalog,
  type PlanEntitlements,
  planEntitlements,
} from "@/lib/entitlements/catalog";
import { loadCommercialSlot } from "./slot-loader";

export interface EntitlementCatalogSlot {
  /**
   * The active catalog. Implementations must return every plan code, and must
   * mark an entitlement `enforced` only when the product measures and applies
   * it — the flag is what separates a published intention from a live limit.
   */
  catalog(): EntitlementCatalog;
}

const fallbackSlot: EntitlementCatalogSlot = { catalog: () => OSS_ENTITLEMENT_CATALOG };

function isWellFormed(catalog: EntitlementCatalog | undefined): catalog is EntitlementCatalog {
  return (
    !!catalog &&
    typeof catalog.version === "string" &&
    catalog.version.length > 0 &&
    !!catalog.plans &&
    COMMERCIAL_PLAN_CODES.every((plan) => !!catalog.plans[plan])
  );
}

async function loadEntitlementCatalogSlot(): Promise<EntitlementCatalogSlot> {
  if (getSpctrePlan() === "oss") return fallbackSlot;

  try {
    const module = await loadCommercialSlot<{ entitlementCatalogService: EntitlementCatalogSlot }>(
      "web/entitlements/index.js",
    );
    return module.entitlementCatalogService;
  } catch (err) {
    logger.warn(
      "Failed to load the commercial entitlement catalog slot; running unmetered. " +
        "Plan capacities will not be enforced and provisioning will record no window.",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return fallbackSlot;
  }
}

/**
 * The catalog this deployment is entitled to apply.
 *
 * A malformed commercial catalog degrades to unmetered rather than to a partly
 * populated one: a missing plan would otherwise read as a zero capacity and
 * refuse a paying tenant's ingest.
 */
export async function resolveEntitlementCatalog(): Promise<EntitlementCatalog> {
  const slot = await loadEntitlementCatalogSlot();
  try {
    const catalog = slot.catalog();
    if (!isWellFormed(catalog)) {
      logger.warn("Commercial entitlement catalog is malformed; running unmetered.");
      return OSS_ENTITLEMENT_CATALOG;
    }
    return catalog;
  } catch (err) {
    logger.warn("Commercial entitlement catalog threw; running unmetered.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return OSS_ENTITLEMENT_CATALOG;
  }
}

/** The active catalog's entry for one plan code. */
export async function resolvePlanEntitlements(
  planCode: string | null | undefined,
): Promise<PlanEntitlements> {
  return planEntitlements(await resolveEntitlementCatalog(), planCode);
}
