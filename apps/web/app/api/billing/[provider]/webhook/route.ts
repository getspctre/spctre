import {
  getCommercialProfileWithContext,
  recordBillingLifecycleEvent,
  resolveTenantIdByBillingCustomerId,
  type BillingLifecycleEvent,
} from "@/lib/domains/billing/service";
import {
  loadBillingWebhookSlot,
  type NormalizedBillingEvent,
} from "@/lib/ee-adapters/billing-webhook";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The provider is a path segment rather than a hardcoded route so that
// verifying a delivery is a commercial slot's job and this file stays free of
// any one provider's signature scheme or event vocabulary. The URL a provider
// is configured with is unchanged.
const PROVIDER_SEGMENT = /^[a-z0-9-]{1,32}$/;

type EventOutcome = "handled" | "unresolved" | "ignored";

/**
 * Which tenant an event is about, preferring what the provider carried over
 * what we can look up.
 */
async function effectiveTenantId(event: NormalizedBillingEvent): Promise<string | null> {
  if (event.tenantId) return event.tenantId;
  if (!event.billingCustomerId) return null;
  return resolveTenantIdByBillingCustomerId(event.billingProvider, event.billingCustomerId).catch(
    swallow("resolveTenantIdByBillingCustomerId", null),
  );
}

/**
 * Whether the tenant was on the free trial immediately before this event.
 *
 * This is the whole reason the telemetry decision cannot live in a slot: it is
 * a read of the tenant's own prior profile, under tenant context, and it is
 * what separates a trial conversion from an ordinary plan change.
 */
async function wasOnTrial(tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;
  const priorProfile = await getCommercialProfileWithContext(tenantId).catch(
    swallow("getCommercialProfileWithContext", null),
  );
  return priorProfile?.planCode === "HOSTED_TRIAL";
}

/** Translate a normalized intent into the lifecycle event to record. */
async function composeLifecycleEvent(
  event: NormalizedBillingEvent,
): Promise<BillingLifecycleEvent | null> {
  const tenantId = await effectiveTenantId(event);
  const base = {
    tenantId,
    billingCustomerId: event.billingCustomerId,
    billingProvider: event.billingProvider,
    metadata: event.metadata,
  };

  switch (event.intent) {
    case "SUBSCRIPTION_ACTIVE":
      return {
        ...base,
        // A null planCode preserves the stored plan. Never default here: the
        // checkout wrote the purchased plan to the shared profile, and a
        // fallback would clobber it (e.g. BUSINESS -> TEAM).
        planCode: event.planCode,
        lifecycleStatus: "ACTIVE",
        salesStatus: "CUSTOMER",
        telemetryEventType: (await wasOnTrial(tenantId)) ? "TRIAL_CONVERTED" : "PLAN_CHANGED",
      };
    case "SUBSCRIPTION_TRIALING":
      return {
        ...base,
        planCode: event.planCode ?? "HOSTED_TRIAL",
        lifecycleStatus: "EVALUATING",
        salesStatus: "NONE",
        telemetryEventType: "TRIAL_START",
      };
    case "SUBSCRIPTION_PAYMENT_FAILED":
      return {
        ...base,
        planCode: event.planCode,
        lifecycleStatus: "PAUSED",
        salesStatus: "CUSTOMER",
        telemetryEventType: "PAYMENT_FAILED",
      };
    case "SUBSCRIPTION_CANCELED":
      return {
        ...base,
        planCode: event.planCode,
        lifecycleStatus: "PAUSED",
        salesStatus: "CUSTOMER",
        telemetryEventType: (await wasOnTrial(tenantId))
          ? "TRIAL_CANCELLED"
          : "SUBSCRIPTION_CANCELLED",
      };
    case "IGNORED":
      return null;
  }
}

async function applyBillingEvent(event: NormalizedBillingEvent): Promise<EventOutcome> {
  const lifecycleEvent = await composeLifecycleEvent(event);
  if (!lifecycleEvent) return "ignored";

  const result = await recordBillingLifecycleEvent(lifecycleEvent);
  if (!result) {
    console.warn("[billing/webhook] could not resolve tenant for billing lifecycle event", {
      billingProvider: event.billingProvider,
      intent: event.intent,
      telemetryEventType: lifecycleEvent.telemetryEventType,
      hasTenantId: Boolean(lifecycleEvent.tenantId),
      hasBillingCustomerId: Boolean(lifecycleEvent.billingCustomerId),
    });
    return "unresolved";
  }
  return "handled";
}

async function handlePostApiBillingByproviderWebhook(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const traceId = extractTraceId(request);
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toLowerCase();

  if (!PROVIDER_SEGMENT.test(provider)) {
    return withTraceId(
      Response.json(
        { error: "Unknown billing provider.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }

  const slot = await loadBillingWebhookSlot();
  if (!slot.handles(provider)) {
    return withTraceId(
      Response.json(
        { error: "Unknown billing provider.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }

  // Read the body as bytes, not as JSON: the signature is over what arrived.
  const rawBody = await request.text();
  const verification = await slot.verify({ provider, rawBody, headers: request.headers });

  if (verification.status === "unconfigured") {
    return withTraceId(
      Response.json({ error: verification.reason, meta: makeMeta(traceId) }, { status: 503 }),
      traceId,
    );
  }
  if (verification.status === "rejected") {
    return withTraceId(
      Response.json({ error: verification.reason, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  }
  if (verification.status === "malformed") {
    return withTraceId(
      Response.json({ error: verification.reason, meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  try {
    const outcome = await applyBillingEvent(verification.event);
    if (outcome === "unresolved") {
      // The provider may deliver to the checkout surface and this endpoint
      // concurrently, so the tenant may not be provisioned yet. Non-2xx makes
      // the provider retry on its backoff schedule instead of dropping the
      // event.
      return withTraceId(
        Response.json(
          { error: "Tenant not resolved for billing event yet.", meta: makeMeta(traceId) },
          { status: 503 },
        ),
        traceId,
      );
    }
    return withTraceId(
      Response.json({ ok: true, handled: outcome === "handled", meta: makeMeta(traceId) }),
      traceId,
    );
  } catch (error) {
    console.error("[billing/webhook] failed to process event", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }
}

export { handlePostApiBillingByproviderWebhook as POST };
