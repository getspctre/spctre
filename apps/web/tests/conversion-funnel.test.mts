import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";
import type {
  BillingWebhookSlot,
  BillingWebhookVerification,
  NormalizedBillingEvent,
} from "../lib/ee-adapters/billing-webhook";

const mockGetCommercialProfile = vi.fn();
const mockRecordBillingLifecycleEvent = vi.fn();
const mockResolveTenantIdByBillingCustomerId = vi.fn();
const mockGetSpctrePlan = vi.fn();
const mockSql = vi.fn();
const mockHandles = vi.fn();
const mockVerify = vi.fn();

vi.mock("@/lib/db", () => ({
  sql: mockSql,
  rawSql: mockSql,
  runWithTenantContext: async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/feature-flags-server", () => ({ getSpctrePlan: mockGetSpctrePlan }));

vi.mock("@/lib/repositories/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/repositories/workspace")>();
  return {
    ...actual,
    getCommercialProfile: mockGetCommercialProfile,
    getCommercialProfileWithContext: mockGetCommercialProfile,
    recordBillingLifecycleEvent: mockRecordBillingLifecycleEvent,
    resolveTenantIdByBillingCustomerId: mockResolveTenantIdByBillingCustomerId,
  };
});

// The provider's own verification is a commercial slot. What is exercised here
// is the half that stays: tenant resolution, the telemetry decision that reads
// the prior profile, and the retry semantics of a delivery whose tenant is not
// provisioned yet.
const stubSlot: BillingWebhookSlot = {
  handles: (provider) => mockHandles(provider) as boolean,
  verify: async (delivery) => mockVerify(delivery) as Promise<BillingWebhookVerification>,
};

vi.mock("@/lib/ee-adapters/billing-webhook", () => ({
  loadBillingWebhookSlot: async () => stubSlot,
}));

const billingWebhookRoute = await import("../app/api/billing/[provider]/webhook/route");
const telemetryEventsRoute = await import("../app/api/telemetry/events/route");

function verifiedEvent(overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent {
  return {
    intent: "SUBSCRIPTION_ACTIVE",
    billingProvider: "PADDLE",
    tenantId: "tenant-trial",
    billingCustomerId: "ctm_123",
    planCode: "TEAM",
    metadata: { billingProvider: "PADDLE", subscriptionId: "sub_123" },
    ...overrides,
  };
}

async function deliver(
  provider = "paddle",
  body: Record<string, unknown> = { event_type: "transaction.completed" },
) {
  return billingWebhookRoute.POST(
    createRouteRequest({ path: `/api/billing/${provider}/webhook`, body }),
    { params: Promise.resolve({ provider }) },
  );
}

/**
 * A delivery whose bytes are chosen, not serialized from an object.
 *
 * `createRouteRequest` JSON.stringifies its body, which is exactly the
 * normalization the raw-body contract exists to rule out — a route that parsed
 * and re-serialized would still satisfy an assertion written against
 * `JSON.stringify(body)`. Only a hand-written body can tell the two apart.
 */
async function deliverRaw(rawBody: string, provider = "paddle") {
  return billingWebhookRoute.POST(
    new Request(new URL(`/api/billing/${provider}/webhook`, "http://localhost:3000"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    }),
    { params: Promise.resolve({ provider }) },
  );
}

describe("Conversion & Trial-to-Paid Funnel", () => {
  beforeEach(() => {
    mockGetCommercialProfile.mockReset();
    mockRecordBillingLifecycleEvent.mockReset();
    mockResolveTenantIdByBillingCustomerId.mockReset();
    mockGetSpctrePlan.mockReset();
    mockSql.mockReset();
    mockHandles.mockReset();
    mockVerify.mockReset();
    mockHandles.mockReturnValue(true);
    mockResolveTenantIdByBillingCustomerId.mockResolvedValue(null);
  });

  describe("Monthly Event Cap & Telemetry", () => {
    it("returns a 410 tombstone for the retired public telemetry endpoint", async () => {
      const response = await telemetryEventsRoute.POST(
        createRouteRequest({
          path: "/api/telemetry/events",
          body: { tenantId: "tenant-1", eventType: "TRIAL_START" },
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(410);
      expect(payload.error).toContain("retired");
      expect(payload.migration.billingWebhook).toBe("/api/billing/{provider}/webhook");
    });
  });

  describe("billing webhook verification", () => {
    it("answers 404 for a provider no implementation handles", async () => {
      mockHandles.mockReturnValue(false);

      const response = await deliver("unknown-provider");

      expect(response.status).toBe(404);
      expect(mockVerify).not.toHaveBeenCalled();
      expect(mockRecordBillingLifecycleEvent).not.toHaveBeenCalled();
    });

    it("answers 404 for a provider segment that could not name one", async () => {
      const response = await deliver("../etc");

      expect(response.status).toBe(404);
      expect(mockHandles).not.toHaveBeenCalled();
    });

    it("records nothing when verification is rejected", async () => {
      mockVerify.mockResolvedValue({ status: "rejected", reason: "Invalid signature." });

      const response = await deliver();

      expect(response.status).toBe(401);
      expect(mockRecordBillingLifecycleEvent).not.toHaveBeenCalled();
    });

    it("distinguishes an unconfigured provider from a malformed delivery", async () => {
      mockVerify.mockResolvedValue({ status: "unconfigured", reason: "No secret configured." });
      expect((await deliver()).status).toBe(503);

      mockVerify.mockResolvedValue({ status: "malformed", reason: "Body must be JSON." });
      expect((await deliver()).status).toBe(400);

      expect(mockRecordBillingLifecycleEvent).not.toHaveBeenCalled();
    });

    it("verifies against the bytes that arrived, not a re-serialized parse", async () => {
      mockVerify.mockResolvedValue({ status: "rejected", reason: "Invalid signature." });
      // Non-canonical spacing that JSON.stringify would collapse. A signature is
      // computed over these bytes, so a route that parsed and re-serialized
      // would fail verification for every genuine delivery.
      const rawBody = '{ "event_type" :  "transaction.completed" }';

      await deliverRaw(rawBody);

      expect(mockVerify).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "paddle", rawBody }),
      );
    });
  });

  describe("lifecycle events from a verified webhook", () => {
    it("records a trial conversion when the tenant was on the free trial", async () => {
      mockVerify.mockResolvedValue({ status: "verified", event: verifiedEvent() });
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-trial" });
      mockGetCommercialProfile.mockResolvedValue({ planCode: "HOSTED_TRIAL" });

      const response = await deliver();
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.handled).toBe(true);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-trial",
          billingCustomerId: "ctm_123",
          billingProvider: "PADDLE",
          planCode: "TEAM",
          lifecycleStatus: "ACTIVE",
          salesStatus: "CUSTOMER",
          telemetryEventType: "TRIAL_CONVERTED",
          metadata: { billingProvider: "PADDLE", subscriptionId: "sub_123" },
        }),
      );
    });

    // Renewals are system-generated and arrive on every billing cycle. Counting
    // them as conversions would inflate the funnel with the same tenant monthly.
    it("records a plan change when the tenant was already paying", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ tenantId: "tenant-paid", planCode: null }),
      });
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });
      mockGetCommercialProfile.mockResolvedValue({ planCode: "BUSINESS" });

      expect((await deliver()).status).toBe(200);
      // A null planCode preserves the stored plan; defaulting here would
      // downgrade a BUSINESS subscriber on every renewal.
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ planCode: null, telemetryEventType: "PLAN_CHANGED" }),
      );
    });

    it("resolves the tenant from the billing customer when the event carries none", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ tenantId: null }),
      });
      mockResolveTenantIdByBillingCustomerId.mockResolvedValue("tenant-paid");
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });
      mockGetCommercialProfile.mockResolvedValue({ planCode: "BUSINESS" });

      expect((await deliver()).status).toBe(200);
      expect(mockResolveTenantIdByBillingCustomerId).toHaveBeenCalledWith("PADDLE", "ctm_123");
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-paid" }),
      );
    });

    it("separates a cancelled trial from a cancelled subscription", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ intent: "SUBSCRIPTION_CANCELED" }),
      });
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-trial" });

      mockGetCommercialProfile.mockResolvedValue({ planCode: "HOSTED_TRIAL" });
      expect((await deliver()).status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          lifecycleStatus: "PAUSED",
          telemetryEventType: "TRIAL_CANCELLED",
        }),
      );

      mockGetCommercialProfile.mockResolvedValue({ planCode: "BUSINESS" });
      expect((await deliver()).status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ telemetryEventType: "SUBSCRIPTION_CANCELLED" }),
      );
    });

    it("records a trialing subscription as a trial start", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ intent: "SUBSCRIPTION_TRIALING", planCode: null }),
      });
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-trial" });

      expect((await deliver()).status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          planCode: "HOSTED_TRIAL",
          lifecycleStatus: "EVALUATING",
          salesStatus: "NONE",
          telemetryEventType: "TRIAL_START",
        }),
      );
    });

    it("pauses the profile on a failed payment", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ intent: "SUBSCRIPTION_PAYMENT_FAILED" }),
      });
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });

      expect((await deliver()).status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycleStatus: "PAUSED",
          salesStatus: "CUSTOMER",
          telemetryEventType: "PAYMENT_FAILED",
        }),
      );
    });

    it("acknowledges an authentic event that is not a lifecycle transition", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ intent: "IGNORED" }),
      });

      const response = await deliver();
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.handled).toBe(false);
      expect(mockRecordBillingLifecycleEvent).not.toHaveBeenCalled();
    });

    it("returns a retryable 503 when a verified event cannot resolve a tenant", async () => {
      mockVerify.mockResolvedValue({
        status: "verified",
        event: verifiedEvent({ tenantId: null, billingCustomerId: null }),
      });
      mockRecordBillingLifecycleEvent.mockResolvedValue(null);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const response = await deliver();
        const payload = await response.json();

        // The provider retries non-2xx deliveries; the tenant may simply not be
        // provisioned yet when this endpoint races the checkout surface.
        expect(response.status).toBe(503);
        expect(payload.error).toContain("Tenant not resolved");
        expect(warnSpy).toHaveBeenCalledWith(
          "[billing/webhook] could not resolve tenant for billing lifecycle event",
          expect.objectContaining({
            billingProvider: "PADDLE",
            intent: "SUBSCRIPTION_ACTIVE",
            hasTenantId: false,
            hasBillingCustomerId: false,
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
