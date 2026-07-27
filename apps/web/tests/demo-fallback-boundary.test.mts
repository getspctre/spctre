import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEMO_TENANT_ID } from "../lib/demo";
import type { WorkspaceContext } from "../lib/workspace/types";
import { selectDemoRulesFallback } from "../app/rules/demo-rules-fallback";
import { resolveComplianceArtifacts } from "../app/compliance/demo-compliance-fallback";

// Every approved demo-fallback consumer must return sample data ONLY for the
// demo tenant. For a real tenant with no database rows, it must return an
// explicit empty/production state — never fabricated records. These tests pin
// that negative path per consumer (see scripts/check-demo-fallbacks.mjs for the
// allowlist they correspond to).

const NON_DEMO_TENANT = "11111111-1111-1111-1111-111111111111";

// No database → every repository read returns empty, so only the demo-tenant
// gate can introduce sample data.
vi.mock("@/lib/db", () => ({
  sql: null,
  rawSql: () => "",
}));
vi.mock("@/lib/feature-flags-server", () => ({
  isFeatureEnabled: () => false,
}));
vi.mock("@/lib/app-view-mode-server", () => ({
  getAppViewMode: async () => "operator",
}));
// The review page model resolves the active actor, which reads cookies when no
// database is configured. Stub it so no actor cookie is present.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: () => null }),
}));

const getWorkspaceContext = vi.fn<(args?: { workspaceSlug?: string }) => Promise<WorkspaceContext>>();
vi.mock("@/lib/workspace", () => ({ getWorkspaceContext }));

const agents = await import("../lib/domains/agents/service");
const evidence = await import("../lib/domains/evidence/service");
const policy = await import("../lib/domains/policy/service");
const { getReviewPageModel } = await import("../app/review/review-page-model");

function workspaceContextFor(tenantId: string): WorkspaceContext {
  return {
    tenantId,
    tenantSlug: "t",
    tenants: [],
    workspaceId: "ws-1",
    workspaceSlug: "prod",
    workspaceName: "Workspace",
    workspaces: [],
    needsCookieNormalization: false,
  };
}

function useTenant(tenantId: string) {
  getWorkspaceContext.mockResolvedValue(workspaceContextFor(tenantId));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agents page model demo boundary", () => {
  it("returns no agents for a real tenant with no data", async () => {
    useTenant(NON_DEMO_TENANT);
    const model = await agents.getAgentsPageModel({ workspaceSlug: "prod" });
    expect(model.agents).toEqual([]);
  });

  it("shows sample agents for the demo tenant", async () => {
    useTenant(DEMO_TENANT_ID);
    const model = await agents.getAgentsPageModel({ workspaceSlug: "demo" });
    expect(model.agents.length).toBeGreaterThan(0);
  });
});

describe("evidence page model demo boundary", () => {
  const query = { text: "", status: "", connector: "" } as never;

  it("returns empty evidence/heatmap for a real tenant with no data", async () => {
    useTenant(NON_DEMO_TENANT);
    const model = await evidence.getEvidencePageModel({ workspaceSlug: "prod", query, pageSize: 10 });
    expect(model.evidence).toEqual([]);
    expect(model.activeHeatmap).toEqual([]);
    expect(model.activeUnused).toEqual([]);
  });

  it("shows sample evidence for the demo tenant", async () => {
    useTenant(DEMO_TENANT_ID);
    const model = await evidence.getEvidencePageModel({ workspaceSlug: "demo", query, pageSize: 10 });
    expect(model.evidence.length).toBeGreaterThan(0);
  });
});

describe("policy page model demo boundary", () => {
  it("returns no branches/rules for a real tenant with no data", async () => {
    useTenant(NON_DEMO_TENANT);
    const model = await policy.getPoliciesPageModel({ workspaceSlug: "prod" });
    expect(model.branches).toEqual([]);
    expect(model.rules).toEqual([]);
  });

  it("shows sample branches/rules for the demo tenant", async () => {
    useTenant(DEMO_TENANT_ID);
    const model = await policy.getPoliciesPageModel({ workspaceSlug: "demo" });
    expect(model.branches.length).toBeGreaterThan(0);
    expect(model.rules.length).toBeGreaterThan(0);
  });
});

describe("review page model demo boundary", () => {
  it("returns no branches or sample artifacts for a real tenant with no data", async () => {
    useTenant(NON_DEMO_TENANT);
    const model = await getReviewPageModel({ workspaceSlug: "prod" });
    expect(model.branches).toEqual([]);
    expect(model.usingRealBranch).toBe(false);
    expect(model.activeDiff).toBeNull();
    expect(model.activeComposition).toBeNull();
  });

  it("shows demo branches and artifacts for the demo tenant", async () => {
    useTenant(DEMO_TENANT_ID);
    const model = await getReviewPageModel({ workspaceSlug: "demo", selectedBranchId: "branch-demo" });
    expect(model.branches.length).toBeGreaterThan(0);
    expect(model.activeDiff).not.toBeNull();
  });
});

describe("rules inventory demo boundary", () => {
  it("returns no sample rules for a real tenant (with or without a query)", () => {
    expect(selectDemoRulesFallback(NON_DEMO_TENANT)).toEqual([]);
    expect(selectDemoRulesFallback(NON_DEMO_TENANT, "stripe")).toEqual([]);
  });

  it("returns sample rules for the demo tenant", () => {
    expect(selectDemoRulesFallback(DEMO_TENANT_ID).length).toBeGreaterThan(0);
  });
});

describe("compliance report demo boundary", () => {
  it("returns null artifacts for a real tenant with no persisted packet", () => {
    const artifacts = resolveComplianceArtifacts(NON_DEMO_TENANT, null, null);
    expect(artifacts.activeTimeline).toBeNull();
    expect(artifacts.activeExport).toBeNull();
    expect(artifacts.activeRetentionPlan).toBeNull();
  });

  it("returns sample artifacts for the demo tenant", () => {
    const artifacts = resolveComplianceArtifacts(DEMO_TENANT_ID, null, null);
    expect(artifacts.activeTimeline).not.toBeNull();
    expect(artifacts.activeExport).not.toBeNull();
    expect(artifacts.activeRetentionPlan).not.toBeNull();
  });
});
