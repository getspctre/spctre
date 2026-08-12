// OSS slot adapter — resolved dynamically or replaced during commercial builds.
//
// Reporting usage to a billing provider is a hosted concern: it needs provider
// credentials, it moves money, and an OSS deployment has no subscription to
// report against. The contract lives here so the control plane can call it
// unconditionally; the implementation is a commercial slot.
//
// The OSS fallback does not throw. Unlike archival or SCIM, where a caller
// asked for a premium capability and deserves an error, nothing in an OSS
// deployment is waiting on a usage submission. Failing loudly would turn a
// correctly-absent integration into recurring noise in a self-hoster's logs.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { loadCommercialSlot } from "./slot-loader";

/** A period's measurement, frozen at the moment it is reported. */
export interface UsageSubmissionRequest {
  tenantId: string;
  usagePeriodId: string;
  metric: "RETAINED_EVENTS" | "SIMULATION_EVENTS";
  /**
   * Composed from tenant, billing period, metric and entitlement version, so
   * two attempts to report the same period collide rather than double-charge.
   */
  idempotencyKey: string;
  reportedQuantity: number;
  includedCapacity: number | null;
  entitlementVersion: string | null;
  periodStart: string;
  periodEnd: string;
}

export interface UsageSubmissionResult {
  status: "SUBMITTED" | "SKIPPED" | "FAILED";
  providerSubmissionId?: string;
  providerInvoiceId?: string;
  error?: string;
}

/** What the provider currently believes about a tenant's subscription. */
export interface SubscriptionState {
  planCode: string | null;
  billingCustomerId: string | null;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface BillingMeteringSlot {
  /**
   * Report a period's usage. Implementations must treat the idempotency key as
   * authoritative and must not create a second charge for a key the provider
   * has already accepted.
   */
  submitUsage(request: UsageSubmissionRequest): Promise<UsageSubmissionResult>;

  /**
   * Read the provider's view of a subscription, so a tenant profile that has
   * drifted from it can be repaired. Returns null when the tenant has no
   * subscription with the provider.
   */
  reconcileSubscription(tenantId: string): Promise<SubscriptionState | null>;

  /**
   * Raise a charge for usage beyond the included capacity. Separate from
   * submitUsage because reporting a quantity and billing for it are distinct
   * decisions: usage is reported throughout a period in observe mode, while a
   * charge is raised only once the overage entitlement is active.
   */
  createOverageInvoiceItem(request: UsageSubmissionRequest): Promise<UsageSubmissionResult>;
}

const fallbackSlot: BillingMeteringSlot = {
  async submitUsage() {
    return { status: "SKIPPED" };
  },
  async reconcileSubscription() {
    return null;
  },
  async createOverageInvoiceItem() {
    return { status: "SKIPPED" };
  },
};

// Resilient slot loader that avoids static imports of ee/ to pass OSS boundary checks
async function loadBillingMeteringSlot(): Promise<BillingMeteringSlot> {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return fallbackSlot;
  }

  try {
    const module = await loadCommercialSlot<{ billingMeteringService: BillingMeteringSlot }>(
      "web/billing/index.js",
    );
    return module.billingMeteringService;
  } catch (err) {
    logger.warn("Failed to load commercial billing metering slot; usage will not be reported.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackSlot;
  }
}

export const billingMeteringService: BillingMeteringSlot = {
  async submitUsage(request) {
    const slot = await loadBillingMeteringSlot();
    return slot.submitUsage(request);
  },
  async reconcileSubscription(tenantId) {
    const slot = await loadBillingMeteringSlot();
    return slot.reconcileSubscription(tenantId);
  },
  async createOverageInvoiceItem(request) {
    const slot = await loadBillingMeteringSlot();
    return slot.createOverageInvoiceItem(request);
  },
};
