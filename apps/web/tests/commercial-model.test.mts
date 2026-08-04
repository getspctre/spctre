import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_VERSION } from "@spctre/api-contracts";

const getWorkspaceContextSpy = vi.fn();
const getCommercialProfileSpy = vi.fn();
const getCommercialUsageSummarySpy = vi.fn();
const listAgentSummariesSpy = vi.fn();
const listBranchesSpy = vi.fn();
const listCommercialEventsSpy = vi.fn();
const listSimulationRunsSpy = vi.fn();
const getAuthSessionSpy = vi.fn();
const revalidatePathSpy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathSpy }));

vi.mock("@spctre/policy-schema", () => ({ POLICY_PACKS: [] }));

vi.mock("@/lib/workspace/server-context", () => ({ getWorkspaceContext: getWorkspaceContextSpy }));

vi.mock("@/lib/workspace-path", () => ({
  buildWorkspacePath: (_workspaceSlug: string, path: string) => path,
}));

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/repositories/evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/repositories/evidence")>();
  return {
    ...actual,
    listAgentSummaries: listAgentSummariesSpy,
    listSimulationRuns: listSimulationRunsSpy,
  };
});

vi.mock("@/lib/repositories/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/repositories/policy")>();
  return { ...actual, listBranches: listBranchesSpy };
});

vi.mock("@/lib/repositories/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/repositories/workspace")>();
  return {
    ...actual,
    getCommercialProfile: getCommercialProfileSpy,
    getCommercialUsageSummary: getCommercialUsageSummarySpy,
    listCommercialEvents: listCommercialEventsSpy,
  };
});

const { normalizeCommercialPlanCode } = await import("../lib/repositories/workspace");
const usageBillingRoute = await import("../app/api/usage-billing/export/route");

describe("commercial model", () => {
  beforeEach(() => {
    getWorkspaceContextSpy.mockReset();
    getCommercialProfileSpy.mockReset();
    getCommercialUsageSummarySpy.mockReset();
    listAgentSummariesSpy.mockReset();
    listBranchesSpy.mockReset();
    listCommercialEventsSpy.mockReset();
    listSimulationRunsSpy.mockReset();
    getAuthSessionSpy.mockReset();
    revalidatePathSpy.mockClear();
  });

  it("defaults and legacy-normalizes the free hosted plan to Hosted Trial", () => {
    expect(normalizeCommercialPlanCode(undefined)).toBe("HOSTED_TRIAL");
    expect(normalizeCommercialPlanCode("OSS_EVALUATION")).toBe("HOSTED_TRIAL");
    expect(normalizeCommercialPlanCode("TEAM")).toBe("TEAM");
  });

  it("exports hosted usage dimensions without OSS pricing language", async () => {
    getAuthSessionSpy.mockResolvedValue({
      principalId: "principal-1",
      email: "admin@example.com",
      subject: "admin@example.com",
    });
    getWorkspaceContextSpy.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "acme",
      workspaceId: "workspace-1",
      workspaceSlug: "default",
    });
    getCommercialProfileSpy.mockResolvedValue({
      planCode: "HOSTED_TRIAL",
      lifecycleStatus: "EVALUATING",
      salesStatus: "NONE",
      billingContactEmail: null,
      updatedAt: null,
    });
    getCommercialUsageSummarySpy.mockResolvedValue({
      workspaceCount: 1,
      policyBundleCount: 2,
      retainedAuditEventCount: 3,
      productionEnvironmentCount: 1,
      serviceTokenCount: 1,
    });
    listBranchesSpy.mockResolvedValue([]);
    listAgentSummariesSpy.mockResolvedValue([]);
    listSimulationRunsSpy.mockResolvedValue([]);
    listCommercialEventsSpy.mockResolvedValue([]);

    const response = await usageBillingRoute.GET(
      new Request("http://localhost:3000/api/usage-billing/export", {
        headers: { "x-request-id": "trace-usage-export" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("trace-usage-export");
    expect(body.profile.planCode).toBe("HOSTED_TRIAL");
    expect(body.hostedUsageDimensions).toMatchObject({
      governedAgents: 0,
      workspaces: 1,
      policyBundles: 2,
      retainedAuditEvents: 3,
    });
    expect(body.meta).toMatchObject({ traceId: "trace-usage-export", version: API_VERSION });
    expect(body.pricingDimensions).toBeUndefined();
  });
});
