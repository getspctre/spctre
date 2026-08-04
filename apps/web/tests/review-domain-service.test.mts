import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ sql: null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-123" }), set: () => {} }),
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({
  ensureDemoTenant: vi.fn(async () => undefined),
}));

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: vi.fn(async () => ({
    tenantId: "00000000-0000-0000-0000-000000000001",
    workspaceId: "workspace-demo",
    workspaceSlug: "default",
  })),
}));

vi.mock("@/lib/app-view-mode-server", () => ({ getAppViewMode: vi.fn(async () => "standard") }));

vi.mock("@/lib/workspace/server-context", () => ({
  getWorkspaceContext: vi.fn(async () => ({
    tenantId: "00000000-0000-0000-0000-000000000001",
    workspaceId: "workspace-demo",
    workspaceSlug: "default",
  })),
}));

const reviewService = await import("../lib/domains/review/service");
const { getReviewPageModel } = await import("../app/review/review-page-model");

describe("review domain service", () => {
  it("guards addApprovalDecision when required inputs are missing", async () => {
    const result = await reviewService.addApprovalDecision(
      { revisionId: "", role: "", approvalStatus: "", note: null },
      { tenantId: "00000000-0000-0000-0000-000000000001", workspaceId: "workspace-demo" },
    );

    expect(result).toEqual({ error: "Review action is unavailable." });
  });

  it("returns a stable infrastructure error when publish is unavailable", async () => {
    const result = await reviewService.publishRevisionDecision(
      { revisionId: "revision-1", branchId: "branch-1" },
      { tenantId: "00000000-0000-0000-0000-000000000001", workspaceId: "workspace-demo" },
    );

    expect(result).toEqual({ error: "Branch not found." });
  });

  it("getReviewPageModel returns demo fallback data for demo tenant", async () => {
    const model = await getReviewPageModel({ workspaceSlug: "default" });

    expect(model.workspaceContext.tenantId).toBe("00000000-0000-0000-0000-000000000001");
    expect(model.branches.length).toBeGreaterThan(0);
    expect(model.usingRealBranch).toBe(false);
    expect(model.activeDiff).not.toBeNull();
  });

  it("does not substitute another branch when a requested branch is unavailable", async () => {
    const model = await getReviewPageModel({
      workspaceSlug: "default",
      selectedBranchId: "branch-missing",
    });

    expect(model.requestedBranchUnavailable).toBe(true);
    expect(model.activeBranch).toBeUndefined();
    expect(model.activeDiff).toBeNull();
  });

  it("createDraftRuleRevisionDecision returns database not configured when DB is not configured", async () => {
    const result = await reviewService.createDraftRuleRevisionDecision({
      branchId: "branch-1",
      baseRevisionId: "rev-1",
      message: "Draft creation",
    });

    expect(result).toEqual({ error: "Database not configured." });
  });

  it("commitRuleRevisionDecision returns database not configured when DB is not configured", async () => {
    const result = await reviewService.commitRuleRevisionDecision({
      branchId: "branch-1",
      parentRevisionId: "rev-1",
      rulesPayload: "[]",
    });

    expect(result).toEqual({ error: "Database not configured." });
  });
});
