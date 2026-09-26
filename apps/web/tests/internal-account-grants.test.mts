import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The provisioning endpoint has two callers with different authority: a checkout
 * surface that may create what it can sell, and an operator credential that may
 * grant an internal account at any tier. These assert that the endpoint
 * authorizes what is asked for rather than only authenticating who asks.
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000301";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000302";
const PRINCIPAL_ID = "00000000-0000-0000-0000-000000000303";

const CHECKOUT_SECRET = "checkout-secret-value";
const GRANT_SECRET = "grant-secret-value";

const provisionHostedTenantSpy = vi.fn();
let checkoutSecret = CHECKOUT_SECRET;
let grantSecret = GRANT_SECRET;
let allowedPlans: string[] = ["HOSTED_TRIAL", "TEAM", "BUSINESS"];

vi.mock("@/lib/platform/config", () => ({
  provisioningSecret: () => checkoutSecret,
  provisioningGrantSecret: () => grantSecret,
  provisioningCheckoutPlans: () => allowedPlans,
}));

vi.mock("@/lib/domains/provisioning/service", () => ({
  provisionHostedTenant: (...args: unknown[]) => provisionHostedTenantSpy(...args),
}));

const { POST } = await import("@/app/api/internal/provisioning/tenant/route");

function request(secret: string | null, body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/internal/provisioning/tenant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = { email: "owner@example.com", name: "Owner", company: "Example" };

describe("internal provisioning credentials", () => {
  beforeEach(() => {
    provisionHostedTenantSpy.mockReset();
    provisionHostedTenantSpy.mockResolvedValue({
      ok: true,
      created: true,
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
    });
    checkoutSecret = CHECKOUT_SECRET;
    grantSecret = GRANT_SECRET;
    allowedPlans = ["HOSTED_TRIAL", "TEAM", "BUSINESS"];
  });

  it("rejects a request with no credential", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request(null, BASE_BODY) as any);
    expect(response.status).toBe(401);
    expect(provisionHostedTenantSpy).not.toHaveBeenCalled();
  });

  it("rejects a credential that matches neither secret", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request("not-a-secret", BASE_BODY) as any);
    expect(response.status).toBe(401);
  });

  it("lets the checkout credential provision a tier it sells, as a customer", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(
      request(CHECKOUT_SECRET, { ...BASE_BODY, plan: "BUSINESS" }) as any,
    );

    expect(response.status).toBe(201);
    expect(provisionHostedTenantSpy).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "BUSINESS", salesStatus: "CUSTOMER" }),
    );
  });

  it("refuses to let the checkout credential mint ENTERPRISE", async () => {
    // A leak of the checkout secret must not be enough to create the tier that
    // is only ever sold through an order form.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(
      request(CHECKOUT_SECRET, { ...BASE_BODY, plan: "ENTERPRISE" }) as any,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "plan_not_permitted_for_credential" });
    expect(provisionHostedTenantSpy).not.toHaveBeenCalled();
  });

  it("refuses to let the checkout credential mark an account INTERNAL", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(
      request(CHECKOUT_SECRET, { ...BASE_BODY, plan: "TEAM", salesStatus: "INTERNAL" }) as any,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "sales_status_not_permitted_for_credential" });
    expect(provisionHostedTenantSpy).not.toHaveBeenCalled();
  });

  it("honors a widened checkout allowlist", async () => {
    // A self-hosted deployment driving provisioning from its own tooling is not
    // gated here: nothing about this is a licence check.
    allowedPlans = ["HOSTED_TRIAL", "TEAM", "BUSINESS", "ENTERPRISE"];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(
      request(CHECKOUT_SECRET, { ...BASE_BODY, plan: "ENTERPRISE" }) as any,
    );

    expect(response.status).toBe(201);
  });

  it("lets the grant credential provision ENTERPRISE as an internal account", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request(GRANT_SECRET, { ...BASE_BODY, plan: "ENTERPRISE" }) as any);

    expect(response.status).toBe(201);
    expect(provisionHostedTenantSpy).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "ENTERPRISE", salesStatus: "INTERNAL" }),
    );
  });

  it("defaults a grant to INTERNAL without the caller asking", async () => {
    // The point of the credential is that its accounts are not customers, so
    // that is the default rather than something each caller must remember.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request(GRANT_SECRET, { ...BASE_BODY, plan: "TEAM" }) as any);

    expect(response.status).toBe(201);
    expect(provisionHostedTenantSpy).toHaveBeenCalledWith(
      expect.objectContaining({ salesStatus: "INTERNAL" }),
    );
  });

  it("gives the narrower authority when both secrets are configured alike", async () => {
    // A misconfiguration that sets both to the same value must not silently
    // hand the checkout surface grant authority.
    grantSecret = CHECKOUT_SECRET;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(
      request(CHECKOUT_SECRET, { ...BASE_BODY, plan: "ENTERPRISE" }) as any,
    );

    expect(response.status).toBe(403);
  });

  it("offers no grant path when the grant secret is unset", async () => {
    grantSecret = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request(GRANT_SECRET, { ...BASE_BODY, plan: "ENTERPRISE" }) as any);

    expect(response.status).toBe(401);
  });

  it("reports a missing configuration rather than provisioning", async () => {
    checkoutSecret = "";
    grantSecret = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request(CHECKOUT_SECRET, BASE_BODY) as any);

    expect(response.status).toBe(500);
    expect(provisionHostedTenantSpy).not.toHaveBeenCalled();
  });
});
