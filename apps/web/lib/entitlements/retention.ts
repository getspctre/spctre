/**
 * Evidence retention window derivation.
 *
 * This module is deliberately dependency-free. It is reachable from client
 * components (the usage and billing surface), so it must not transitively
 * import `@/lib/db` — that would pull `async_hooks` into a client bundle and
 * fail the web build. The active catalog is resolved by the caller, which is
 * always a server context, and passed in.
 *
 * Before this existed the window was derived in four places that disagreed:
 * the retention worker treated `retention_window_days` as an override for
 * every plan, while the three TypeScript call sites consulted it only for
 * ENTERPRISE. A tenant with a negotiated window on any other plan was pruned
 * on one schedule and archived on another.
 *
 * A `null` window means retain indefinitely. It is the OSS default and it is
 * what a tenant gets when no catalog claims otherwise, so every caller must
 * treat it as "do not prune" rather than coercing it to a number.
 */

import {
  FALLBACK_PLAN_CODE,
  isCommercialPlanCode,
  planEntitlements,
  type CommercialPlanCode,
  type EntitlementCatalog,
} from "./catalog";

export type { CommercialPlanCode };

/**
 * The fields of a commercial profile that bear on retention. Declared
 * structurally so this module needs no import from the repository layer.
 */
export interface RetentionProfileInput {
  planCode?: string | null;
  retentionWindowDays?: number | null;
}

function planDefaultDays(
  catalog: EntitlementCatalog,
  planCode: string | null | undefined,
): number | null {
  return planEntitlements(catalog, planCode).retentionWindowDays.value;
}

/**
 * Resolve the effective retention window for a tenant, or null to retain
 * indefinitely.
 *
 * An explicit `retention_window_days` wins for **every** plan, not only
 * ENTERPRISE: it is the negotiated or provisioned value and the retention
 * worker has always treated it that way. A non-positive stored value is
 * treated as unset rather than as "retain nothing", so bad data degrades to
 * the plan default instead of deleting a tenant's evidence.
 */
export function resolveRetentionWindowDays(
  profile: RetentionProfileInput | null,
  catalog: EntitlementCatalog,
): number | null {
  const override = profile?.retentionWindowDays;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return planDefaultDays(catalog, profile?.planCode);
}

/**
 * The instant retained evidence ingested at `from` becomes eligible for
 * pruning, or null when the tenant's evidence has no expiry.
 */
export function resolveRetainUntil(
  profile: RetentionProfileInput | null,
  catalog: EntitlementCatalog,
  from: Date = new Date(),
): Date | null {
  const days = resolveRetentionWindowDays(profile, catalog);
  if (days === null) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Human-readable description of the effective window, for compliance surfaces. */
export function describeRetentionWindow(
  profile: RetentionProfileInput | null,
  catalog: EntitlementCatalog,
): string {
  const days = resolveRetentionWindowDays(profile, catalog);
  const rawPlan = profile?.planCode;
  const planCode: CommercialPlanCode = isCommercialPlanCode(rawPlan) ? rawPlan : FALLBACK_PLAN_CODE;
  const displayName = planEntitlements(catalog, planCode).displayName;

  if (days === null) return `${displayName} — evidence retained indefinitely`;
  return `${displayName} ${days}-day retention limit`;
}
