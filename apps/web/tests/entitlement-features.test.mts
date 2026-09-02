import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "22222222-2222-4222-8222-222222222222";

const getRuntimeConfigSpy = vi.fn();
const getTenantPlanCodeWithContextSpy = vi.fn();
const resolvePlanEntitlementsSpy = vi.fn();

vi.mock("@/lib/config/runtime", () => ({ getRuntimeConfig: getRuntimeConfigSpy }));

vi.mock("@/lib/repositories/workspace/commercial", () => ({
  getTenantPlanCodeWithContext: getTenantPlanCodeWithContextSpy,
}));

vi.mock("@/lib/ee-adapters/entitlement-catalog", () => ({
  resolvePlanEntitlements: resolvePlanEntitlementsSpy,
}));

const { isFeatureEntitled, resolveTenantPlan, getEntitledFeatureFlags } = await import(
  "../lib/entitlements/features"
);

function hosted(plan: string) {
  getRuntimeConfigSpy.mockReturnValue({ plan, singleTenantMode: false });
}

/** The tier the catalog reports for whatever plan code was looked up. */
function catalogTier(tier: string) {
  resolvePlanEntitlementsSpy.mockResolvedValue({ tier });
}

describe("tenant feature entitlement", () => {
  beforeEach(() => {
    getRuntimeConfigSpy.mockReset();
    getTenantPlanCodeWithContextSpy.mockReset();
    resolvePlanEntitlementsSpy.mockReset();
  });

  describe("resolveTenantPlan", () => {
    it("is the lower of the deployment plan and the tenant's tier", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("TEAM");
      catalogTier("cloud");

      await expect(resolveTenantPlan(TENANT)).resolves.toBe("cloud");
    });

    it("caps a tenant above the deployment's licence at the deployment plan", async () => {
      hosted("cloud");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("ENTERPRISE");
      catalogTier("enterprise");

      await expect(resolveTenantPlan(TENANT)).resolves.toBe("cloud");
    });

    // A licensed self-hosted install has no billing relationship with itself.
    // Clamping it to the tier a missing profile implies would revoke the plan
    // it installed under.
    it("gives a tenant with no commercial profile the deployment plan", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue(null);

      await expect(resolveTenantPlan(TENANT)).resolves.toBe("enterprise");
      expect(resolvePlanEntitlementsSpy).not.toHaveBeenCalled();
    });

    it("short-circuits a declared single-tenant deployment without a lookup", async () => {
      getRuntimeConfigSpy.mockReturnValue({ plan: "business", singleTenantMode: true });

      await expect(resolveTenantPlan(TENANT)).resolves.toBe("business");
      expect(getTenantPlanCodeWithContextSpy).not.toHaveBeenCalled();
    });

    it("resolves an OSS deployment without a lookup", async () => {
      hosted("oss");

      await expect(resolveTenantPlan(TENANT)).resolves.toBe("oss");
      expect(getTenantPlanCodeWithContextSpy).not.toHaveBeenCalled();
    });

    it("treats an absent tenant as entitled to nothing", async () => {
      hosted("enterprise");

      await expect(resolveTenantPlan(null)).resolves.toBe("oss");
      expect(getTenantPlanCodeWithContextSpy).not.toHaveBeenCalled();
    });
  });

  describe("isFeatureEntitled", () => {
    // The regression the module exists for: a hosted deployment necessarily
    // runs at the top plan it sells, so reading that plan as the tenant's
    // entitlement hands a free trial the whole catalog.
    it("withholds an Enterprise feature from a trial tenant on an enterprise deployment", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("HOSTED_TRIAL");
      catalogTier("cloud");

      await expect(isFeatureEntitled("samlScimProvisioning", TENANT)).resolves.toBe(false);
      await expect(isFeatureEntitled("multiTenantWorkspaceIsolation", TENANT)).resolves.toBe(false);
      await expect(isFeatureEntitled("compliancePdfExport", TENANT)).resolves.toBe(false);
    });

    it("grants the trial tenant the Cloud features its tier includes", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("HOSTED_TRIAL");
      catalogTier("cloud");

      await expect(isFeatureEntitled("longTermForensicArchival", TENANT)).resolves.toBe(true);
      await expect(isFeatureEntitled("slaTrackedHitlQueue", TENANT)).resolves.toBe(true);
    });

    // A downgrade must actually take the feature away, which is the half that
    // a deployment-wide gate could never express.
    it("revokes a feature when the tenant's plan code drops", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("BUSINESS");
      catalogTier("business");
      await expect(isFeatureEntitled("compliancePdfExport", TENANT)).resolves.toBe(true);

      getTenantPlanCodeWithContextSpy.mockResolvedValue("TEAM");
      catalogTier("cloud");
      await expect(isFeatureEntitled("compliancePdfExport", TENANT)).resolves.toBe(false);
    });

    // Granting on failure cannot be withdrawn once the error passes — an
    // archive is written, a packet is exported. Denying is a retry.
    it("denies when the plan code cannot be read", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockRejectedValue(new Error("connection terminated"));

      await expect(isFeatureEntitled("longTermForensicArchival", TENANT)).resolves.toBe(false);
    });

    it("denies when the catalog throws", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("ENTERPRISE");
      resolvePlanEntitlementsSpy.mockRejectedValue(new Error("slot unavailable"));

      await expect(isFeatureEntitled("samlScimProvisioning", TENANT)).resolves.toBe(false);
    });
  });

  describe("getEntitledFeatureFlags", () => {
    it("resolves every flag from one plan lookup", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockResolvedValue("TEAM");
      catalogTier("cloud");

      const flags = await getEntitledFeatureFlags(TENANT);

      expect(flags.longTermForensicArchival).toBe(true);
      expect(flags.compliancePdfExport).toBe(false);
      expect(flags.samlScimProvisioning).toBe(false);
      expect(getTenantPlanCodeWithContextSpy).toHaveBeenCalledTimes(1);
    });

    it("denies every flag when resolution fails", async () => {
      hosted("enterprise");
      getTenantPlanCodeWithContextSpy.mockRejectedValue(new Error("connection terminated"));

      const flags = await getEntitledFeatureFlags(TENANT);

      expect(Object.values(flags).every((enabled) => enabled === false)).toBe(true);
    });
  });
});
