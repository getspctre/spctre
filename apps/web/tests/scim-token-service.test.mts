import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";

const getRuntimeConfigSpy = vi.fn();
const getTenantPlanCodeWithContextSpy = vi.fn();
const resolveScimTokenBySecretSpy = vi.fn();

vi.mock("@/lib/config/runtime", () => ({ getRuntimeConfig: getRuntimeConfigSpy }));

vi.mock("@/lib/repositories/workspace/commercial", () => ({
  getTenantPlanCodeWithContext: getTenantPlanCodeWithContextSpy,
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

const { isScimProvisioningEntitled, resolveScimTokenBinding } =
  await import("../lib/domains/scim-token/service");

/** A deployment plan with no single-tenant declaration: the hosted shape. */
function hosted(plan: "oss" | "cloud" | "business" | "enterprise") {
  getRuntimeConfigSpy.mockReturnValue({ plan, singleTenantMode: false });
}

describe("SCIM token entitlement and binding", () => {
  beforeEach(() => {
    getRuntimeConfigSpy.mockReset();
    getTenantPlanCodeWithContextSpy.mockReset();
    resolveScimTokenBySecretSpy.mockReset();
    getTenantPlanCodeWithContextSpy.mockResolvedValue("HOSTED_TRIAL");
  });

  // The regression this file exists for. A hosted deployment runs at the
  // highest plan it sells, so an "is the deployment enterprise?" check passes
  // for every tenant on it — including the trial accounts SCIM is sold against.
  it("does not entitle a trial tenant on a hosted enterprise deployment", async () => {
    hosted("enterprise");
    getTenantPlanCodeWithContextSpy.mockResolvedValue("HOSTED_TRIAL");

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(false);
    expect(getTenantPlanCodeWithContextSpy).toHaveBeenCalledWith(TENANT);
  });

  it("entitles an ENTERPRISE tenant on a hosted enterprise deployment", async () => {
    hosted("enterprise");
    getTenantPlanCodeWithContextSpy.mockResolvedValue("ENTERPRISE");

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(true);
  });

  // A licensed self-hosted install has no commercial relationship with itself,
  // so it has no profile row. It must keep what it installed rather than being
  // clamped to the trial tier a missing row would otherwise imply.
  it("entitles a tenant with no commercial profile on an enterprise deployment", async () => {
    hosted("enterprise");
    getTenantPlanCodeWithContextSpy.mockResolvedValue(null);

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(true);
  });

  it("entitles every tenant on a declared single-tenant deployment", async () => {
    getRuntimeConfigSpy.mockReturnValue({ plan: "enterprise", singleTenantMode: true });

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(true);
    expect(getTenantPlanCodeWithContextSpy).not.toHaveBeenCalled();
  });

  it("never entitles tenants on an OSS deployment", async () => {
    hosted("oss");

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(false);
    expect(getTenantPlanCodeWithContextSpy).not.toHaveBeenCalled();
  });

  // The deployment plan is a ceiling a purchase cannot exceed: an ENTERPRISE
  // tenant on a deployment licensed only for Cloud is still capped at Cloud.
  it("caps a tenant's tier at the deployment plan", async () => {
    hosted("cloud");
    getTenantPlanCodeWithContextSpy.mockResolvedValue("ENTERPRISE");

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(false);
  });

  it("denies rather than grants when the plan code cannot be read", async () => {
    hosted("enterprise");
    getTenantPlanCodeWithContextSpy.mockRejectedValue(new Error("connection terminated"));

    await expect(isScimProvisioningEntitled(TENANT)).resolves.toBe(false);
  });

  it("reports unknown tokens without an entitlement lookup", async () => {
    hosted("enterprise");
    resolveScimTokenBySecretSpy.mockResolvedValue(null);

    await expect(resolveScimTokenBinding("scim_missing")).resolves.toEqual({
      ok: false,
      reason: "unknown_token",
    });
    expect(getTenantPlanCodeWithContextSpy).not.toHaveBeenCalled();
  });

  it("refuses a resolved token whose tenant lost entitlement", async () => {
    hosted("enterprise");
    resolveScimTokenBySecretSpy.mockResolvedValue({ tenantId: TENANT, registrationId: "reg-1" });
    getTenantPlanCodeWithContextSpy.mockResolvedValue("TEAM");

    await expect(resolveScimTokenBinding("scim_downgraded")).resolves.toEqual({
      ok: false,
      reason: "not_entitled",
    });
  });

  it("binds a token to its tenant when the tenant is entitled", async () => {
    hosted("enterprise");
    resolveScimTokenBySecretSpy.mockResolvedValue({ tenantId: TENANT, registrationId: "reg-1" });
    getTenantPlanCodeWithContextSpy.mockResolvedValue("ENTERPRISE");

    await expect(resolveScimTokenBinding("scim_valid")).resolves.toEqual({
      ok: true,
      tenantId: TENANT,
      registrationId: "reg-1",
    });
  });
});
