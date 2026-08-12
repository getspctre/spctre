import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createRouteRequest } from "./route-test-helper";

const mockGetCommercialProfile = vi.fn();
const mockRecordBillingLifecycleEvent = vi.fn();
const mockResolveTenantIdByBillingCustomerId = vi.fn();
const mockGetSpctrePlan = vi.fn();
const mockSql = vi.fn();

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

const paddleWebhookRoute = await import("../app/api/billing/paddle/webhook/route");
const telemetryEventsRoute = await import("../app/api/telemetry/events/route");

function paddleSignature(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}:${body}`).digest("hex");
  return `ts=${timestamp};h1=${signature}`;
}

describe("Conversion & Trial-to-Paid Funnel", () => {
  const originalPaddleSecret = process.env.PADDLE_WEBHOOK_SECRET;

  beforeEach(() => {
    mockGetCommercialProfile.mockReset();
    mockRecordBillingLifecycleEvent.mockReset();
    mockResolveTenantIdByBillingCustomerId.mockReset();
    mockGetSpctrePlan.mockReset();
    mockSql.mockReset();
    process.env.PADDLE_WEBHOOK_SECRET = originalPaddleSecret;
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
      expect(payload.migration.billingWebhook).toBe("/api/billing/paddle/webhook");
    });
  });

  describe("Paddle conversion webhook", () => {
    it("records trial conversion from a signed transaction.completed webhook without telemetry PII", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      let capturedEvent: { metadata?: Record<string, unknown> } | undefined;
      mockRecordBillingLifecycleEvent.mockImplementation(async (event) => {
        capturedEvent = event;
        return { tenantId: "tenant-trial" };
      });
      mockGetCommercialProfile.mockResolvedValue({
        planCode: "HOSTED_TRIAL",
        lifecycleStatus: "EVALUATING",
        salesStatus: "NONE",
      });
      const body = JSON.stringify({
        event_id: "evt_123",
        event_type: "transaction.completed",
        data: {
          customer_id: "ctm_123",
          subscription_id: "sub_123",
          custom_data: { tenantId: "tenant-trial", planCode: "TEAM" },
        },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );
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
        }),
      );
      expect(capturedEvent?.metadata).toMatchObject({
        billingProvider: "PADDLE",
        paddleEventType: "transaction.completed",
        planCode: "TEAM",
        subscriptionId: "sub_123",
      });
      expect(capturedEvent?.metadata).not.toHaveProperty("billingCustomerId");
    });

    it("rejects unsigned Paddle webhooks", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body: JSON.stringify({ event_type: "transaction.completed" }),
        }),
      );

      expect(response.status).toBe(401);
      expect(mockRecordBillingLifecycleEvent).not.toHaveBeenCalled();
    });

    it("records subscription.activated as trial conversion only when prior plan is hosted trial", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-trial" });
      mockGetCommercialProfile.mockResolvedValue({
        planCode: "HOSTED_TRIAL",
        lifecycleStatus: "EVALUATING",
        salesStatus: "NONE",
      });
      const body = JSON.stringify({
        event_type: "subscription.activated",
        data: {
          customer_id: "ctm_123",
          status: "active",
          custom_data: { tenantId: "tenant-trial", planCode: "TEAM" },
        },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledTimes(1);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ telemetryEventType: "TRIAL_CONVERTED" }),
      );
    });

    it("records subscription.updated active as plan change for existing paid tenants", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });
      mockGetCommercialProfile.mockResolvedValue({
        planCode: "TEAM",
        lifecycleStatus: "ACTIVE",
        salesStatus: "CUSTOMER",
      });
      const body = JSON.stringify({
        event_type: "subscription.updated",
        data: {
          customer_id: "ctm_123",
          status: "active",
          custom_data: { tenantId: "tenant-paid", planCode: "BUSINESS" },
        },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledTimes(1);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ telemetryEventType: "PLAN_CHANGED" }),
      );
    });

    it("returns a retryable 503 when a signed billing event cannot resolve a tenant", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue(null);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = JSON.stringify({
        event_type: "transaction.payment_failed",
        data: { status: "past_due", custom_data: {} },
      });

      try {
        const response = await paddleWebhookRoute.POST(
          new Request("http://localhost:3000/api/billing/paddle/webhook", {
            method: "POST",
            body,
            headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
          }),
        );
        const payload = await response.json();

        // Paddle retries non-2xx deliveries; the tenant may simply not be
        // provisioned yet when this endpoint races the marketing-site webhook.
        expect(response.status).toBe(503);
        expect(payload.error).toContain("Tenant not resolved");
        expect(warnSpy).toHaveBeenCalledWith(
          "[billing/paddle/webhook] could not resolve tenant for billing lifecycle event",
          expect.objectContaining({
            paddleEventType: "transaction.payment_failed",
            telemetryEventType: "PAYMENT_FAILED",
            hasTenantId: false,
            hasBillingCustomerId: false,
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("preserves the stored plan when subscription.activated carries no plan code", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });
      mockGetCommercialProfile.mockResolvedValue({
        planCode: "BUSINESS",
        lifecycleStatus: "ACTIVE",
        salesStatus: "CUSTOMER",
      });
      mockResolveTenantIdByBillingCustomerId.mockResolvedValue("tenant-paid");
      const body = JSON.stringify({
        event_type: "subscription.activated",
        data: { customer_id: "ctm_123", status: "active", custom_data: {} },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );

      expect(response.status).toBe(200);
      // A null planCode preserves the stored plan; a TEAM fallback here would
      // downgrade BUSINESS subscribers provisioned by the marketing site.
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ planCode: null, telemetryEventType: "PLAN_CHANGED" }),
      );
    });

    it("records renewal transactions as plan changes, not trial conversions", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });
      mockGetCommercialProfile.mockResolvedValue({
        planCode: "BUSINESS",
        lifecycleStatus: "ACTIVE",
        salesStatus: "CUSTOMER",
      });
      mockResolveTenantIdByBillingCustomerId.mockResolvedValue("tenant-paid");
      const body = JSON.stringify({
        event_type: "transaction.completed",
        data: { customer_id: "ctm_123", subscription_id: "sub_123", custom_data: {} },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ planCode: null, telemetryEventType: "PLAN_CHANGED" }),
      );
    });

    it("records subscription.canceled as paid subscription cancellation for paid tenants", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-paid" });
      mockGetCommercialProfile.mockResolvedValue({
        planCode: "BUSINESS",
        lifecycleStatus: "ACTIVE",
        salesStatus: "CUSTOMER",
      });
      const body = JSON.stringify({
        event_type: "subscription.canceled",
        data: {
          customer_id: "ctm_123",
          status: "canceled",
          custom_data: { tenantId: "tenant-paid", planCode: "BUSINESS" },
        },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ telemetryEventType: "SUBSCRIPTION_CANCELLED" }),
      );
    });

    it("records trialing subscription updates as trial start", async () => {
      process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test";
      mockRecordBillingLifecycleEvent.mockResolvedValue({ tenantId: "tenant-trial" });
      const body = JSON.stringify({
        event_type: "subscription.trialing",
        data: {
          customer_id: "ctm_123",
          status: "trialing",
          custom_data: { tenantId: "tenant-trial", planCode: "HOSTED_TRIAL" },
        },
      });

      const response = await paddleWebhookRoute.POST(
        new Request("http://localhost:3000/api/billing/paddle/webhook", {
          method: "POST",
          body,
          headers: { "paddle-signature": paddleSignature(body, "pdl_ntfset_test") },
        }),
      );

      expect(response.status).toBe(200);
      expect(mockRecordBillingLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycleStatus: "EVALUATING",
          salesStatus: "NONE",
          telemetryEventType: "TRIAL_START",
        }),
      );
    });
  });
});
