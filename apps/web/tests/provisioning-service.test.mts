import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000201";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000202";
const PRINCIPAL_ID = "00000000-0000-0000-0000-000000000203";

const findHostedOwnerByEmailSpy = vi.fn();
const createHostedTenantSpy = vi.fn();
const ensureDefaultPublishedPolicyPackSpy = vi.fn();
const boundTenants: string[] = [];

vi.mock("@/lib/repositories/provisioning", () => ({
  findHostedOwnerByEmail: (...args: unknown[]) => findHostedOwnerByEmailSpy(...args),
  createHostedTenant: (...args: unknown[]) => createHostedTenantSpy(...args),
  HOSTED_PLAN_CODES: ["HOSTED_TRIAL", "TEAM", "BUSINESS", "ENTERPRISE"],
}));

vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: ensureDefaultPublishedPolicyPackSpy,
}));

vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: () => true,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: async (tenantId: string, fn: () => Promise<unknown>) => {
    boundTenants.push(tenantId);
    return fn();
  },
}));

const { provisionHostedTenant } = await import("@/lib/domains/provisioning/service");

describe("provisionHostedTenant", () => {
  beforeEach(() => {
    findHostedOwnerByEmailSpy.mockReset();
    createHostedTenantSpy.mockReset();
    ensureDefaultPublishedPolicyPackSpy.mockReset();
    boundTenants.length = 0;
    createHostedTenantSpy.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
    });
    findHostedOwnerByEmailSpy.mockResolvedValue(null);
  });

  it("creates the tenant and seeds its baseline policy", async () => {
    const result = await provisionHostedTenant({
      email: "Buyer@Example.com",
      displayName: "Buyer",
      company: "Example Corp",
      plan: "BUSINESS",
    });

    expect(result).toEqual({
      ok: true,
      created: true,
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
    });
    expect(createHostedTenantSpy).toHaveBeenCalledWith({
      email: "buyer@example.com",
      displayName: "Buyer",
      company: "Example Corp",
      planCode: "BUSINESS",
    });
    expect(ensureDefaultPublishedPolicyPackSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      actorId: PRINCIPAL_ID,
    });
    expect(boundTenants).toEqual([TENANT_ID]);
  });

  it("returns the existing tenant instead of creating a second one", async () => {
    findHostedOwnerByEmailSpy.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
    });

    const result = await provisionHostedTenant({
      email: "buyer@example.com",
      displayName: "Buyer",
    });

    expect(result).toMatchObject({ ok: true, created: false, tenantId: TENANT_ID });
    expect(createHostedTenantSpy).not.toHaveBeenCalled();
  });

  it("falls back to the Team plan when the plan code is unrecognised", async () => {
    await provisionHostedTenant({
      email: "buyer@example.com",
      displayName: "Buyer",
      plan: "PLATINUM",
    });

    expect(createHostedTenantSpy.mock.calls[0][0]).toMatchObject({ planCode: "TEAM" });
  });

  it("derives a company name when checkout does not supply one", async () => {
    await provisionHostedTenant({ email: "buyer@example.com", displayName: "Buyer" });

    expect(createHostedTenantSpy.mock.calls[0][0]).toMatchObject({ company: "Buyer's Org" });
  });

  it("rejects a request without a usable email or name", async () => {
    expect(await provisionHostedTenant({ email: "", displayName: "Buyer" })).toEqual({
      error: "invalid_request",
    });
    expect(await provisionHostedTenant({ email: "not-an-email", displayName: "Buyer" })).toEqual({
      error: "invalid_request",
    });
    expect(await provisionHostedTenant({ email: "buyer@example.com", displayName: "" })).toEqual({
      error: "invalid_request",
    });
    expect(createHostedTenantSpy).not.toHaveBeenCalled();
  });

  it("does not seed a baseline when tenant creation fails", async () => {
    createHostedTenantSpy.mockResolvedValue(null);

    const result = await provisionHostedTenant({
      email: "buyer@example.com",
      displayName: "Buyer",
    });

    expect(result).toEqual({ error: "create_failed" });
    expect(ensureDefaultPublishedPolicyPackSpy).not.toHaveBeenCalled();
  });
});
