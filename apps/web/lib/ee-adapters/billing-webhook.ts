// OSS slot adapter — resolved dynamically or replaced during commercial builds.
//
// An inbound billing webhook is entirely provider knowledge: the signature
// scheme and the header it arrives in, the event vocabulary, the field names a
// payload carries, and which of those events mean a subscription started,
// lapsed or ended. None of it describes how the product behaves, and an OSS
// deployment has no payment provider to receive one from.
//
// What stays on this side is everything that touches a tenant: resolving which
// tenant an event belongs to, reading the prior commercial profile to tell a
// trial conversion from a plan change, writing the lifecycle event under tenant
// context, and deciding whether an unresolved event should be retried. A slot
// therefore verifies and normalizes; it never persists.
//
// The fallback handles no provider at all, so the route answers 404. That is
// the honest answer for a deployment with no billing integration: the endpoint
// exists in the routing table, and there is nothing behind it.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import type { BillingLifecycleEvent } from "@/lib/repositories/workspace/commercial";
import { loadCommercialSlot } from "./slot-loader";

export interface BillingWebhookDelivery {
  /** The provider segment from the request path, lowercased. */
  provider: string;
  /**
   * The exact bytes as received. Signature verification is over the raw body,
   * so this must never be a re-serialized parse of it.
   */
  rawBody: string;
  headers: Headers;
}

/**
 * What a verified event means, in terms the control plane can act on without
 * knowing the provider's vocabulary.
 *
 * Deliberately coarse. A provider distinguishes a paused subscription from a
 * past-due one and a failed payment from a dunning retry; the commercial
 * profile has one PAUSED state for all of them, so mapping every such event to
 * one intent here keeps the provider's taxonomy out of shared code.
 */
export type BillingLifecycleIntent =
  | "SUBSCRIPTION_ACTIVE"
  | "SUBSCRIPTION_TRIALING"
  | "SUBSCRIPTION_PAYMENT_FAILED"
  | "SUBSCRIPTION_CANCELED"
  /** Received and authentic, but not a lifecycle transition we act on. */
  | "IGNORED";

export interface NormalizedBillingEvent {
  intent: BillingLifecycleIntent;
  /**
   * The provider tag written to `tenant_commercial_profile.billing_provider`.
   * Adding a provider means widening this union and the column's check
   * constraint together — the value is persisted, not merely routed.
   */
  billingProvider: BillingLifecycleEvent["billingProvider"];
  /** From the provider's own custom data, when the checkout carried it. */
  tenantId: string | null;
  billingCustomerId: string | null;
  /**
   * Null preserves the stored plan. A slot must not substitute a default: a
   * renewal event carries no checkout data, and defaulting would downgrade a
   * paying subscriber on every billing cycle.
   */
  planCode: string | null;
  /** Provider-shaped detail, recorded verbatim on the lifecycle event. */
  metadata: Record<string, unknown>;
}

export type BillingWebhookVerification =
  | { status: "verified"; event: NormalizedBillingEvent }
  /** Authenticity failed. The route answers 401 and records nothing. */
  | { status: "rejected"; reason: string }
  /** Authentic but unparseable. 400 — retrying an identical body cannot help. */
  | { status: "malformed"; reason: string }
  /** The provider is known but not configured (no secret). 503. */
  | { status: "unconfigured"; reason: string };

export interface BillingWebhookSlot {
  /** Whether this implementation verifies deliveries for a provider slug. */
  handles(provider: string): boolean;
  /**
   * Verify authenticity and normalize. Implementations must verify before
   * parsing, and must never treat an unverified payload as a source of tenant
   * identity.
   */
  verify(delivery: BillingWebhookDelivery): Promise<BillingWebhookVerification>;
}

const fallbackSlot: BillingWebhookSlot = {
  handles: () => false,
  async verify(delivery) {
    return {
      status: "unconfigured",
      reason: `No billing webhook implementation is installed for "${delivery.provider}".`,
    };
  },
};

export async function loadBillingWebhookSlot(): Promise<BillingWebhookSlot> {
  if (getSpctrePlan() === "oss") return fallbackSlot;

  try {
    const module = await loadCommercialSlot<{ billingWebhookService: BillingWebhookSlot }>(
      "web/billing/webhook.js",
    );
    return module.billingWebhookService;
  } catch (err) {
    // Failing closed here means refusing deliveries rather than processing
    // unverified ones. A billing event is worth losing before it is worth
    // trusting, and the provider will retry.
    logger.error(
      "Failed to load the commercial billing webhook slot; deliveries will be refused.",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return fallbackSlot;
  }
}
