import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";

const getSpctrePlanSpy = vi.fn();
const getCommercialProfileWithContextSpy = vi.fn();
const resolveScimTokenBySecretSpy = vi.fn();

vi.mock("@/lib/feature-flags-server", () => ({
  getSpctrePlan: getSpctrePlanSpy,
}));

vi.mock("@/lib/repositories/workspace/commercial", () => ({
  getCommercialProfileWithContext: getCommercialProfileWithContextSpy,
}));

vi.mock("@/lib/repositories/scim-token", () => ({
  resolveScimTokenBySecret: resolveScimTokenBySecretSpy,
  createScimTokenRegistration: vi.fn(),
  revokeScimTokenRegistration: vi.fn(),
  listScimTokenRegistrations: vi.fn(),
}));

vi.mock("@/lib/repositories/operations-log/log", () => ({
  appendOperationsLog: vi.fn().mockResolvedValue(undefined),
}));

const { isScimProvisioningEntitled, resolveScimTokenBinding } = await import(
  "../lib/domains/scim-token/service"
);

describe("SCIM token entitlement and binding", () => {
  beforeEach(() => {
    getSpctrePlanSpy.mockReset();
    getCommercialProfileWithContextSpy.mockReset();
    resolveScimTokenBySecretSpy.mockReset();
    getCommercialProfileWithContextSpy.mockResolvedValue({ planCode: "HOSTED_TRIAL" });
  });

  it("entitles every tenant on a self-hosted enterprise deployment", async () => {
    getSpctrePlanSpy.mockReturnValue("enterprise");

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(true);
    expect(getCommercialProfileWithContextSpy).not.toHaveBeenCalled();
  });

  it("never entitles tenants on an OSS deployment", async () => {
    getSpctrePlanSpy.mockReturnValue("oss");

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(false);
    expect(getCommercialProfileWithContextSpy).not.toHaveBeenCalled();
  });

  it("requires an ENTERPRISE commercial plan on hosted deployments", async () => {
    getSpctrePlanSpy.mockReturnValue("cloud");

    getCommercialProfileWithContextSpy.mockResolvedValue({ planCode: "BUSINESS" });
    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(false);

    getCommercialProfileWithContextSpy.mockResolvedValue({ planCode: "ENTERPRISE" });
    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(true);
  });

  it("reports unknown tokens without an entitlement lookup", async () => {
    getSpctrePlanSpy.mockReturnValue("cloud");
    resolveScimTokenBySecretSpy.mockResolvedValue(null);

    await expect(resolveScimTokenBinding("scim_missing")).resolves.toEqual({
      ok: false,
      reason: "unknown_token",
    });
    expect(getCommercialProfileWithContextSpy).not.toHaveBeenCalled();
  });

  it("refuses a resolved token whose tenant lost entitlement", async () => {
    getSpctrePlanSpy.mockReturnValue("cloud");
    resolveScimTokenBySecretSpy.mockResolvedValue({ tenantId: TENANT, registrationId: "reg-1" });
    getCommercialProfileWithContextSpy.mockResolvedValue({ planCode: "TEAM" });

    await expect(resolveScimTokenBinding("scim_downgraded")).resolves.toEqual({
      ok: false,
      reason: "not_entitled",
    });
  });

  it("binds a token to its tenant when the tenant is entitled", async () => {
    getSpctrePlanSpy.mockReturnValue("cloud");
    resolveScimTokenBySecretSpy.mockResolvedValue({ tenantId: TENANT, registrationId: "reg-1" });
    getCommercialProfileWithContextSpy.mockResolvedValue({ planCode: "ENTERPRISE" });

    await expect(resolveScimTokenBinding("scim_valid")).resolves.toEqual({
      ok: true,
      tenantId: TENANT,
      registrationId: "reg-1",
    });
  });
});
