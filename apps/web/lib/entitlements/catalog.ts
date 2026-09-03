/**
 * The entitlement catalog contract, and the catalog an OSS deployment uses.
 *
 * One versioned definition of what each plan includes, read by provisioning,
 * quota checks, the retention worker (via the window materialized onto the
 * tenant profile), the usage and billing surface, and billing.
 *
 * ## Where the numbers live
 *
 * A plan's capacities are commercial packaging, not product behaviour: they
 * belong to whoever operates a paid offering, and they change on a commercial
 * cadence rather than a release one. This module therefore defines the *shape*
 * of a catalog and ships the one an unlicensed deployment runs on — every
 * entitlement unlimited and unenforced. A commercial deployment supplies its
 * own catalog through the entitlement-catalog slot
 * (`@/lib/ee-adapters/entitlement-catalog`).
 *
 * That split is what keeps a hosted packaging decision out of a self-hosted
 * install. Nothing here may carry a paid plan's capacity, because everything
 * here binds a deployment that never bought one.
 *
 * ## Enforcement state is part of the contract
 *
 * Every entitlement carries an explicit `enforced` flag alongside its value.
 * `enforced: false` means the number is the commercial *intention* and nothing
 * in the product measures or applies it. Such a value must never be rendered as
 * an active limit, and no upgrade prompt may imply a cap is being calculated
 * from it. This is what stops published capacity claims from outrunning the
 * code that enforces them.
 *
 * A `null` value means unlimited: no capacity, and — for the retention window —
 * no expiry, so evidence is retained until an operator says otherwise.
 *
 * This module is deliberately dependency-free: it is reachable from client
 * components, so a transitive import of the database layer would pull
 * `async_hooks` into a client bundle and fail the web build. Resolving the
 * active catalog is a server concern and lives in the slot adapter.
 */

import type { SpctrePlan } from "@/lib/feature-flags";

export type CommercialPlanCode = "HOSTED_TRIAL" | "TEAM" | "BUSINESS" | "ENTERPRISE";

export const COMMERCIAL_PLAN_CODES: readonly CommercialPlanCode[] = [
  "HOSTED_TRIAL",
  "TEAM",
  "BUSINESS",
  "ENTERPRISE",
];

export interface Entitlement<T> {
  value: T;
  /**
   * Whether the product actually measures and applies this value today. A
   * `false` entry is a commercial intention, not a live limit.
   */
  enforced: boolean;
}

export interface PlanEntitlements {
  displayName: string;
  /**
   * The capability tier this plan grants.
   *
   * A plan code is a SKU and a tier is a capability rank, and they are kept
   * apart on purpose: SKUs churn on a commercial cadence — pricing
   * experiments, grandfathered terms, annual and monthly variants — while
   * tiers change only when the product gains or moves a capability. Many SKUs
   * may share a tier, and adding a SKU must not require touching a feature
   * gate.
   *
   * Unlike the capacities below, a tier carries no `enforced` flag. Enforcement
   * state distinguishes a published number from a measured one; a tier is not a
   * measurement, it is the definition of what the SKU includes, and it is
   * applied the moment it is read.
   */
  tier: SpctrePlan;
  /** Maximum workspaces per tenant; `null` is unlimited. */
  workspaces: Entitlement<number | null>;
  /**
   * Standing capacity of retained governed events — how many the tenant may
   * hold, not a per-period ingest throughput allowance. Evidence leaving the
   * retention window frees capacity again. `null` is unlimited.
   */
  retainedEvents: Entitlement<number | null>;
  /**
   * Evidence retention window in days. `null` retains indefinitely: the
   * retention worker prunes nothing and archived records are given no expiry.
   */
  retentionWindowDays: Entitlement<number | null>;
  /** Included bulk-simulation source events; `null` means no quota. */
  simulationEvents: Entitlement<number | null>;
}

export interface EntitlementCatalog {
  /**
   * Bumped whenever a value in the catalog changes. Persisted with every
   * provisioning decision so a historical retention or capacity decision stays
   * explainable after the catalog moves on.
   */
  version: string;
  plans: Record<CommercialPlanCode, PlanEntitlements>;
}

export const OSS_ENTITLEMENT_CATALOG_VERSION = "oss-unmetered.2";

/** Unlimited, and explicitly not enforced. */
function unmetered(): Entitlement<number | null> {
  return { value: null, enforced: false };
}

function unmeteredPlan(displayName: string, tier: SpctrePlan): PlanEntitlements {
  return {
    displayName,
    tier,
    workspaces: unmetered(),
    retainedEvents: unmetered(),
    retentionWindowDays: unmetered(),
    simulationEvents: unmetered(),
  };
}

/**
 * The catalog an OSS deployment runs on.
 *
 * Plan names and their tiers survive because a self-hosted operator may still
 * be looking at a hosted plan they are considering, and because a tier says
 * what a SKU includes rather than how much of it — the same statement on every
 * deployment that recognizes the SKU. The capacities do not survive, because no
 * part of this deployment is entitled to enforce them. A deployment that never entered
 * a commercial relationship must not have its ingest refused, its workspaces
 * capped, or — most consequentially — its evidence pruned on a schedule set by
 * someone else's free tier.
 */
export const OSS_ENTITLEMENT_CATALOG: EntitlementCatalog = {
  version: OSS_ENTITLEMENT_CATALOG_VERSION,
  plans: {
    HOSTED_TRIAL: unmeteredPlan("Hosted Trial", "cloud"),
    TEAM: unmeteredPlan("Team", "cloud"),
    BUSINESS: unmeteredPlan("Business", "business"),
    ENTERPRISE: unmeteredPlan("Enterprise", "enterprise"),
  },
};

/** Applied when a plan code is absent or unrecognized. */
export const FALLBACK_PLAN_CODE: CommercialPlanCode = "HOSTED_TRIAL";

export function isCommercialPlanCode(value: unknown): value is CommercialPlanCode {
  return typeof value === "string" && COMMERCIAL_PLAN_CODES.includes(value as CommercialPlanCode);
}

/** Resolve a stored plan code to a catalog entry, falling back to the trial. */
export function planEntitlements(
  catalog: EntitlementCatalog,
  planCode: string | null | undefined,
): PlanEntitlements {
  return catalog.plans[isCommercialPlanCode(planCode) ? planCode : FALLBACK_PLAN_CODE];
}

/**
 * The value of an entitlement, regardless of enforcement state. Use this for
 * provisioning and measurement. Use {@link enforcedEntitlementValue} anywhere
 * the number is presented to a user as a limit.
 */
export function entitlementValue<T>(entitlement: Entitlement<T>): T {
  return entitlement.value;
}

/**
 * The value of an entitlement only if the product actually enforces it, and
 * `null` otherwise. Presentation surfaces must use this so an unenforced
 * intention never renders as an active limit, and enforcement paths must use it
 * so an unenforced intention never becomes one.
 */
export function enforcedEntitlementValue<T>(entitlement: Entitlement<T | null>): T | null {
  return entitlement.enforced ? entitlement.value : null;
}
