/**
 * The commercial entitlement catalog.
 *
 * One versioned definition of what each plan includes, read by provisioning,
 * quota checks, the retention worker (via the window materialized onto the
 * tenant profile), the usage and billing surface, and billing.
 *
 * Like `./retention.ts`, this module is deliberately dependency-free: it is
 * reachable from client components, so a transitive import of the database
 * layer would pull `async_hooks` into a client bundle and fail the web build.
 *
 * ## Enforcement state is part of the contract
 *
 * Every entitlement carries an explicit `enforced` flag alongside its value.
 * `enforced: false` means the number is the commercial *intention* and nothing
 * in the product measures or applies it. Such a value must never be rendered as
 * an active limit, and no upgrade prompt may imply a cap is being calculated
 * from it. This is what stops published capacity claims from outrunning the
 * code that enforces them.
 */

export type CommercialPlanCode = "HOSTED_TRIAL" | "TEAM" | "BUSINESS" | "ENTERPRISE";

export const COMMERCIAL_PLAN_CODES: readonly CommercialPlanCode[] = [
  "HOSTED_TRIAL",
  "TEAM",
  "BUSINESS",
  "ENTERPRISE",
];

/**
 * Bumped whenever a value in this catalog changes. Persisted with every
 * provisioning decision so a historical retention or capacity decision stays
 * explainable after the catalog moves on.
 */
export const ENTITLEMENT_CATALOG_VERSION = "2026-08-11.1";

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
  /** Maximum workspaces per tenant. */
  workspaces: Entitlement<number>;
  /**
   * Standing capacity of retained governed events — how many the tenant may
   * hold, not a per-period ingest throughput allowance. Evidence leaving the
   * retention window frees capacity again.
   */
  retainedEvents: Entitlement<number>;
  /** Evidence retention window in days. */
  retentionWindowDays: Entitlement<number>;
  /** Included bulk-simulation source events; `null` means sample-only, no quota. */
  simulationEvents: Entitlement<number | null>;
}

/**
 * Enforcement states reflect what the code does *right now*, which is why the
 * same entitlement can be enforced on one plan and not another:
 *
 * - `workspaces` — enforced at workspace creation, every plan.
 * - `retentionWindowDays` — enforced by the retention worker's prune.
 * - `retainedEvents` — enforced on HOSTED_TRIAL only, as a hard cap: ingest
 *   returns 429 once a trial tenant holds this many retained events. Paid
 *   plans are not yet measured, so their capacity must not render as a live
 *   limit. Flipping those to `true` is the final rollout step and is gated on
 *   a complete billing period of reconciled measurement.
 * - `simulationEvents` — surfaced only. No metering hook exists in the
 *   simulation path.
 */
export const PLAN_ENTITLEMENTS: Record<CommercialPlanCode, PlanEntitlements> = {
  HOSTED_TRIAL: {
    displayName: "Hosted Trial",
    workspaces: { value: 1, enforced: true },
    // Enforced as a hard 429 on the ingest path. Changing this number changes
    // the free tier.
    retainedEvents: { value: 1_000, enforced: true },
    retentionWindowDays: { value: 90, enforced: true },
    simulationEvents: { value: null, enforced: false },
  },
  TEAM: {
    displayName: "Team",
    workspaces: { value: 3, enforced: true },
    retainedEvents: { value: 100_000, enforced: false },
    retentionWindowDays: { value: 365, enforced: true },
    simulationEvents: { value: null, enforced: false },
  },
  BUSINESS: {
    displayName: "Business",
    workspaces: { value: 12, enforced: true },
    retainedEvents: { value: 1_000_000, enforced: false },
    retentionWindowDays: { value: 1095, enforced: true },
    simulationEvents: { value: 50_000, enforced: false },
  },
  ENTERPRISE: {
    displayName: "Enterprise",
    // Enterprise entitlements are negotiated. These are the starting reference
    // point; a contracted tenant overrides them on its own profile.
    workspaces: { value: 50, enforced: true },
    retainedEvents: { value: 10_000_000, enforced: false },
    retentionWindowDays: { value: 2555, enforced: true },
    simulationEvents: { value: 1_000_000, enforced: false },
  },
};

/** Applied when a plan code is absent or unrecognized. */
export const FALLBACK_PLAN_CODE: CommercialPlanCode = "HOSTED_TRIAL";

export function isCommercialPlanCode(value: unknown): value is CommercialPlanCode {
  return typeof value === "string" && value in PLAN_ENTITLEMENTS;
}

/** Resolve a stored plan code to a catalog entry, falling back to the trial. */
export function planEntitlements(planCode: string | null | undefined): PlanEntitlements {
  return PLAN_ENTITLEMENTS[isCommercialPlanCode(planCode) ? planCode : FALLBACK_PLAN_CODE];
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
 * intention never renders as an active limit.
 */
export function enforcedEntitlementValue<T>(entitlement: Entitlement<T>): T | null {
  return entitlement.enforced ? entitlement.value : null;
}
