import { describe, expect, it, vi } from "vitest";

const getBranchWithPublishStatusMock = vi.fn();
const deletePolicyBranchMock = vi.fn();
const getLatestPublishedBundleMock = vi.fn();
const runWithTenantContextMock = vi.fn(async (_tenantId: string, work: () => Promise<unknown>) => work());

vi.mock("@/lib/db", () => ({
  sql: null,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: runWithTenantContextMock,
}));

vi.mock("@/lib/repositories/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/policy")>();
  return {
    ...actual,
    getBranchWithPublishStatus: getBranchWithPublishStatusMock,
    deletePolicyBranch: deletePolicyBranchMock,
    getLatestPublishedBundle: getLatestPublishedBundleMock,
  };
});

const policyService = await import("../lib/domains/policy/service");

describe("policy domain service", () => {
  it("binds the tenant before reading a published bundle", async () => {
    const bundle = { artifactHash: "sha256:published" };
    getLatestPublishedBundleMock.mockResolvedValue(bundle);

    await expect(policyService.getLatestPublishedPolicyBundle({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    })).resolves.toBe(bundle);

    expect(runWithTenantContextMock).toHaveBeenCalledWith("tenant-1", expect.any(Function));
    expect(getLatestPublishedBundleMock).toHaveBeenCalledWith("workspace-1", "tenant-1");
  });

  it("creates an empty branch draft when the database is unavailable", async () => {
    const result = await policyService.createPolicyBranchDecision({
      branchName: "stripe/refund-controls",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: "",
      targetStacks: [],
    });

    expect(result).toMatchObject({
      branchId: expect.any(String),
      revisionId: expect.any(String),
    });
  });

  it("validates importPolicyDecision required source", async () => {
    const result = await policyService.importPolicyDecision({
      source: "",
      branchName: "main",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: "",
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).toEqual({ error: "Policy source is required." });
  });

  it("rejects customer imports that claim the reserved advisor namespace", async () => {
    const result = await policyService.importPolicyDecision({
      source: `rules:\n  - stable_rule_id: spctre-agent.customer.override\n    title: Customer override\n    effect: DENY\n    domains: [advisors]\n    connectors: [spctre-agent]\n    actions: [advisor.recommendation]`,
      branchName: "advisor-controls",
      scope: "CONNECTOR",
      environment: "",
      connector: "spctre-agent",
      requestedWorkspaceId: "",
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).toEqual({
      error: 'Stable rule ID "spctre-agent.customer.override" is reserved for Spctre Advisor Governance. Use your organization\'s namespace instead.',
    });
  });

  it("returns stable error when rollback DB is unavailable", async () => {
    const result = await policyService.rollbackBranchDecision({
      branchId: "branch-1",
      targetRevisionId: "revision-1",
    });

    expect(result).toEqual({ error: "Database not configured." });
  });

  it("requires the branch name, rather than a separate DELETE token, before deletion", async () => {
    getBranchWithPublishStatusMock.mockResolvedValue({
      id: "branch-1",
      name: "acquisition-outreach",
      has_published_revision: false,
    });

    const rejected = await policyService.deleteUnpublishedBranchDecision({
      tenantId: "tenant-1",
      branchId: "branch-1",
      confirmation: "DELETE",
    });
    expect(rejected).toEqual({ error: "Type the branch name exactly to delete: acquisition-outreach" });
    expect(deletePolicyBranchMock).not.toHaveBeenCalled();

    const deleted = await policyService.deleteUnpublishedBranchDecision({
      tenantId: "tenant-1",
      branchId: "branch-1",
      confirmation: "acquisition-outreach",
    });
    expect(deleted).toEqual({ success: true });
    expect(deletePolicyBranchMock).toHaveBeenCalledWith({ tenantId: "tenant-1", branchId: "branch-1" });
  });
});
