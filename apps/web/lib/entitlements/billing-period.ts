/**
 * Billing-period identity for usage measurement.
 *
 * Dependency-free, like the rest of `lib/entitlements`.
 *
 * A period is the UTC calendar month, half-open: `[start, end)`. Calendar
 * months are chosen deliberately over the subscription's own anniversary
 * cycle for this stage of metering:
 *
 *   - measurement must work for tenants with no subscription at all (trials,
 *     self-hosted), which have no anniversary to align to;
 *   - a fixed, globally shared boundary makes reconciliation a single sweep
 *     rather than one scheduled per tenant;
 *   - the boundary is derivable from a timestamp alone, so the ingest path
 *     needs no subscription lookup to decide which row to increment.
 *
 * When usage is submitted to the billing provider, the provider's own period
 * is what an invoice is drawn against. Mapping these months onto that cycle is
 * the submission layer's job, and the period recorded here is what makes that
 * mapping auditable.
 */

export interface BillingPeriod {
  /** Inclusive start of the period. */
  start: Date;
  /** Exclusive end of the period. */
  end: Date;
}

/** The period containing `at`. */
export function resolveBillingPeriod(at: Date = new Date()): BillingPeriod {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

/** Whether `at` falls inside `period`. Half-open, so `end` is excluded. */
export function isWithinBillingPeriod(period: BillingPeriod, at: Date): boolean {
  return at.getTime() >= period.start.getTime() && at.getTime() < period.end.getTime();
}
