/**
 * Evidence retention window derivation.
 *
 * This module is deliberately dependency-free. It is reachable from client
 * components (the usage and billing surface), so it must not transitively
 * import `@/lib/db` — that would pull `async_hooks` into a client bundle and
 * fail the web build.
 *
 * Before this existed the window was derived in four places that disagreed:
 * the retention worker treated `retention_window_days` as an override for
 * every plan, while the three TypeScript call sites consulted it only for
 * ENTERPRISE. A tenant with a negotiated window on any other plan was pruned
 * on one schedule and archived on another.
 */

import {
  COMMERCIAL_PLAN_CODES,
  FALLBACK_PLAN_CODE,
  PLAN_ENTITLEMENTS,
  isCommercialPlanCode,
  planEntitlements,
  type CommercialPlanCode,
} from "./catalog";

export type { CommercialPlanCode };

/** Default window per plan, in days, when the tenant has no explicit override. */
export const PLAN_RETENTION_WINDOW_DAYS: Record<CommercialPlanCode, number> = Object.fromEntries(
  COMMERCIAL_PLAN_CODES.map((plan) => [plan, PLAN_ENTITLEMENTS[plan].retentionWindowDays.value]),
) as Record<CommercialPlanCode, number>;

/** Applied when the plan code is absent or unrecognized. */
export const FALLBACK_RETENTION_WINDOW_DAYS =
  PLAN_ENTITLEMENTS[FALLBACK_PLAN_CODE].retentionWindowDays.value;

/**
 * The fields of a commercial profile that bear on retention. Declared
 * structurally so this module needs no import from the repository layer.
 */
export interface RetentionProfileInput {
  planCode?: string | null;
  retentionWindowDays?: number | null;
}

function planDefaultDays(planCode: string | null | undefined): number {
  return planEntitlements(planCode).retentionWindowDays.value;
}

/**
 * Resolve the effective retention window for a tenant.
 *
 * An explicit `retention_window_days` wins for **every** plan, not only
 * ENTERPRISE: it is the negotiated or provisioned value and the retention
 * worker has always treated it that way. A non-positive stored value is
 * treated as unset rather than as "retain nothing", so bad data degrades to
 * the plan default instead of deleting a tenant's evidence.
 */
export function resolveRetentionWindowDays(profile: RetentionProfileInput | null): number {
  const override = profile?.retentionWindowDays;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return planDefaultDays(profile?.planCode);
}

/** The instant retained evidence ingested at `from` becomes eligible for pruning. */
export function resolveRetainUntil(
  profile: RetentionProfileInput | null,
  from: Date = new Date(),
): Date {
  const days = resolveRetentionWindowDays(profile);
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Copy for a plan sitting on its default window, where the duration is fixed. */
const PLAN_DEFAULT_RETENTION_LABELS: Record<CommercialPlanCode, string> = {
  HOSTED_TRIAL: "Hosted Trial 90-day retention limit",
  TEAM: "Team 1-year retention limit",
  BUSINESS: "Business 3-year retention limit",
  // Enterprise windows are negotiated, so the day count is meaningful even at
  // the default and is always shown.
  ENTERPRISE: "",
};

/** Human-readable description of the effective window, for compliance surfaces. */
export function describeRetentionWindow(profile: RetentionProfileInput | null): string {
  const days = resolveRetentionWindowDays(profile);
  const rawPlan = profile?.planCode;
  const planCode = isCommercialPlanCode(rawPlan) ? rawPlan : FALLBACK_PLAN_CODE;
  const displayName = PLAN_ENTITLEMENTS[planCode].displayName;

  if (days !== planDefaultDays(planCode) || planCode === "ENTERPRISE") {
    return `${displayName} ${days}-day retention limit`;
  }
  return PLAN_DEFAULT_RETENTION_LABELS[planCode];
}
