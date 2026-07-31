import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getCommercialProfileWithContext,
  normalizeCommercialPlanCode,
  recordBillingLifecycleEvent,
  resolveTenantIdByBillingCustomerId,
} from "@/lib/domains/billing/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNATURE_TOLERANCE_SECONDS = 300;

type PaddleWebhookEvent = {
  event_id?: string;
  event_type?: string;
  data?: Record<string, unknown>;
};

type CancellationTelemetryEvent = "TRIAL_CANCELLED" | "SUBSCRIPTION_CANCELLED";

// "unresolved" means the event was relevant but the tenant could not be
// resolved yet (e.g. the marketing site's provisioning webhook has not stored
// the Paddle customer id). The route returns a non-2xx for it so Paddle
// retries the delivery instead of dropping the lifecycle event.
type EventOutcome = "handled" | "unresolved" | "ignored";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function customDataFrom(object: Record<string, unknown>): Record<string, unknown> {
  return asRecord(object.custom_data);
}

function tenantIdFrom(object: Record<string, unknown>): string | null {
  const customData = customDataFrom(object);
  return asString(customData.tenantId) ?? asString(customData.spctreTenantId);
}

function planCodeFrom(object: Record<string, unknown>): string | null {
  const customData = customDataFrom(object);
  // The marketing-site checkout writes "planCode"; "plan" is kept for
  // compatibility with its provisioning webhook payloads.
  return asString(customData.planCode) ?? asString(customData.spctrePlanCode) ?? asString(customData.plan);
}

function customerIdFrom(object: Record<string, unknown>): string | null {
  return asString(object.customer_id);
}

async function effectiveTenantIdFrom(tenantId: string | null, customerId: string | null): Promise<string | null> {
  return tenantId ?? (customerId
    ? await resolveTenantIdByBillingCustomerId("PADDLE", customerId).catch(swallow("resolveTenantIdByBillingCustomerId", null))
    : null);
}

function parsePaddleSignature(signatureHeader: string | null): { timestamp: string; signature: string } | null {
  if (!signatureHeader) return null;
  const parts = new Map(
    signatureHeader.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    })
  );
  const timestamp = parts.get("ts");
  const signature = parts.get("h1");
  return timestamp && signature ? { timestamp, signature } : null;
}

function verifyPaddleSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  const parsed = parsePaddleSignature(signatureHeader);
  if (!parsed) return false;

  const timestampSeconds = Number.parseInt(parsed.timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}:${rawBody}`)
    .digest("hex");

  const actualBuffer = Buffer.from(parsed.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function recordPaddleBillingLifecycle(
  paddleEventType: string,
  event: Parameters<typeof recordBillingLifecycleEvent>[0]
): Promise<EventOutcome> {
  const result = await recordBillingLifecycleEvent(event);
  if (!result) {
    console.warn("[billing/paddle/webhook] could not resolve tenant for billing lifecycle event", {
      paddleEventType,
      telemetryEventType: event.telemetryEventType,
      hasTenantId: Boolean(event.tenantId),
      hasBillingCustomerId: Boolean(event.billingCustomerId),
    });
    return "unresolved";
  }
  return "handled";
}

async function cancellationTelemetryEventFor(
  tenantId: string | null,
  customerId: string | null
): Promise<{ tenantId: string | null; eventType: CancellationTelemetryEvent }> {
  const effectiveTenantId = await effectiveTenantIdFrom(tenantId, customerId);
  const priorProfile = effectiveTenantId
    ? await getCommercialProfileWithContext(effectiveTenantId).catch(swallow("getCommercialProfileWithContext", null))
    : null;
  return {
    tenantId: effectiveTenantId,
    eventType: priorProfile?.planCode === "HOSTED_TRIAL" ? "TRIAL_CANCELLED" : "SUBSCRIPTION_CANCELLED",
  };
}

async function activationTelemetryEventFor(
  tenantId: string | null,
  customerId: string | null
): Promise<{ tenantId: string | null; eventType: "TRIAL_CONVERTED" | "PLAN_CHANGED" }> {
  const effectiveTenantId = await effectiveTenantIdFrom(tenantId, customerId);
  const priorProfile = effectiveTenantId
    ? await getCommercialProfileWithContext(effectiveTenantId).catch(swallow("getCommercialProfileWithContext", null))
    : null;
  return {
    tenantId: effectiveTenantId,
    eventType: priorProfile?.planCode === "HOSTED_TRIAL" ? "TRIAL_CONVERTED" : "PLAN_CHANGED",
  };
}

interface PaddleEventContext {
  tenantId: string | null;
  planCode: string | null;
  customerId: string | null;
  status: string | null;
  aggregateMetadata: Record<string, unknown>;
}

async function handleSubscriptionActiveEvent(type: string, ctx: PaddleEventContext): Promise<EventOutcome> {
  const { tenantId, planCode, customerId, aggregateMetadata } = ctx;
  const activation = await activationTelemetryEventFor(tenantId, customerId);

  return recordPaddleBillingLifecycle(type, {
    tenantId: activation.tenantId,
    billingCustomerId: customerId,
    billingProvider: "PADDLE",
    // A null planCode preserves the stored plan. Never default here: the
    // marketing-site webhook writes the purchased plan to the shared profile,
    // and a hardcoded fallback would clobber it (e.g. BUSINESS -> TEAM).
    planCode,
    lifecycleStatus: "ACTIVE",
    salesStatus: "CUSTOMER",
    telemetryEventType: activation.eventType,
    metadata: aggregateMetadata,
  });
}

async function handleSubscriptionStatusEvent(type: string, ctx: PaddleEventContext): Promise<EventOutcome> {
  const { tenantId, planCode, customerId, status, aggregateMetadata } = ctx;

  if (type === "subscription.activated" || status === "active") {
    return handleSubscriptionActiveEvent(type, ctx);
  }

  if (
    type === "subscription.past_due" || status === "past_due" ||
    type === "subscription.paused" || status === "paused"
  ) {
    return recordPaddleBillingLifecycle(type, {
      tenantId,
      billingCustomerId: customerId,
      billingProvider: "PADDLE",
      planCode,
      lifecycleStatus: "PAUSED",
      salesStatus: "CUSTOMER",
      telemetryEventType: "PAYMENT_FAILED",
      metadata: aggregateMetadata,
    });
  }

  if (type === "subscription.canceled" || status === "canceled") {
    const cancellation = await cancellationTelemetryEventFor(tenantId, customerId);
    return recordPaddleBillingLifecycle(type, {
      tenantId: cancellation.tenantId,
      billingCustomerId: customerId,
      billingProvider: "PADDLE",
      planCode,
      lifecycleStatus: "PAUSED",
      salesStatus: "CUSTOMER",
      telemetryEventType: cancellation.eventType,
      metadata: aggregateMetadata,
    });
  }

  if (type === "subscription.trialing" || status === "trialing") {
    return recordPaddleBillingLifecycle(type, {
      tenantId,
      billingCustomerId: customerId,
      billingProvider: "PADDLE",
      planCode: planCode ?? "HOSTED_TRIAL",
      lifecycleStatus: "EVALUATING",
      salesStatus: "NONE",
      telemetryEventType: "TRIAL_START",
      metadata: aggregateMetadata,
    });
  }

  return "ignored";
}

async function handlePaddleEvent(event: PaddleWebhookEvent): Promise<EventOutcome> {
  const type = event.event_type ?? "";
  const object = asRecord(event.data);
  const tenantId = tenantIdFrom(object);
  const planCode = planCodeFrom(object);
  const customerId = customerIdFrom(object);
  const status = asString(object.status);
  const subscriptionId = asString(object.subscription_id) ?? asString(object.id);
  const aggregateMetadata = {
    billingProvider: "PADDLE",
    paddleEventType: type,
    planCode: planCode ? normalizeCommercialPlanCode(planCode) : undefined,
    subscriptionStatus: status ?? undefined,
    subscriptionId,
  };

  if (type === "transaction.completed" || type === "transaction.paid") {
    // Only the first completed transaction converts a trial. Renewals are
    // system-generated: the prior profile is already on a paid plan, so they
    // record as PLAN_CHANGED instead of inflating trial-conversion telemetry.
    const activation = await activationTelemetryEventFor(tenantId, customerId);
    return recordPaddleBillingLifecycle(type, {
      tenantId: activation.tenantId,
      billingCustomerId: customerId,
      billingProvider: "PADDLE",
      // Renewal transactions do not carry the checkout custom_data, so
      // planCode is usually absent here. Pass it through (null preserves the
      // stored plan) instead of defaulting, which would downgrade paid
      // BUSINESS/ENTERPRISE subscribers on every billing cycle.
      planCode,
      lifecycleStatus: "ACTIVE",
      salesStatus: "CUSTOMER",
      telemetryEventType: activation.eventType,
      metadata: aggregateMetadata,
    });
  }

  if (type === "transaction.payment_failed" || type === "transaction.past_due") {
    return recordPaddleBillingLifecycle(type, {
      tenantId,
      billingCustomerId: customerId,
      billingProvider: "PADDLE",
      planCode,
      lifecycleStatus: "PAUSED",
      salesStatus: "CUSTOMER",
      telemetryEventType: "PAYMENT_FAILED",
      metadata: aggregateMetadata,
    });
  }

  if (type.startsWith("subscription.")) {
    return handleSubscriptionStatusEvent(type, { tenantId, planCode, customerId, status, aggregateMetadata });
  }

  return "ignored";
}

async function handlePostApiBillingPaddleWebhook(request: Request) {
  const traceId = extractTraceId(request);
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return withTraceId(Response.json({ error: "Paddle webhook secret is not configured.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("paddle-signature") || request.headers.get("Paddle-Signature");
  if (!verifyPaddleSignature(rawBody, signatureHeader, secret)) {
    return withTraceId(Response.json({ error: "Invalid Paddle signature.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  let event: PaddleWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PaddleWebhookEvent;
  } catch {
    return withTraceId(Response.json({ error: "Request body must be JSON.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  try {
    const outcome = await handlePaddleEvent(event);
    if (outcome === "unresolved") {
      // Paddle delivers to the marketing site and this endpoint concurrently;
      // the tenant may not be provisioned yet. Non-2xx makes Paddle retry on
      // its backoff schedule instead of dropping the event.
      return withTraceId(Response.json({ error: "Tenant not resolved for billing event yet.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
    }
    return withTraceId(Response.json({ ok: true, handled: outcome === "handled", meta: makeMeta(traceId) }), traceId);
  } catch (error) {
    console.error("[billing/paddle/webhook] failed to process event", error);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
}

export { handlePostApiBillingPaddleWebhook as POST };
