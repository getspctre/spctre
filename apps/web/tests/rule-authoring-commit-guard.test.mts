import { describe, expect, it, vi } from "vitest";

// Reach commitRuleRevisionDecision's lineage guard (which runs after the branch
// lookup and before actor/rule loading) with the smallest viable mock surface.
vi.mock("@/lib/repositories/shared/database", () => ({ isDatabaseConfigured: () => true }));

vi.mock("@/lib/workspace", () => ({
  getWorkspaceContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    workspaceSlug: "default",
  })),
}));

const getBranchForRollback = vi.fn();
const getRevisionForDraft = vi.fn();
vi.mock("@/lib/repositories/policy", () => ({
  getBranchForRollback,
  getRevisionForDraft,
  createDraftRevision: vi.fn(),
  createCommittedRevision: vi.fn(),
}));

vi.mock("@/lib/actors", () => ({ getActiveActor: vi.fn(), requireActorAdminWorkspace: vi.fn() }));
vi.mock("@/lib/repositories/shared/rules", () => ({ listRulesForRevision: vi.fn(async () => []) }));
vi.mock("@/lib/repositories/workspace", () => ({
  insertAuthorizationDenialEvent: vi.fn(async () => undefined),
}));

const { commitRuleRevisionDecision } = await import("../lib/domains/review/rule-authoring");

const VALID_PAYLOAD = JSON.stringify([
  {
    stableRuleId: "org.rule",
    title: "Rule",
    effect: "WARN",
    domains: [],
    connectors: [],
    actions: [],
    immutable: false,
  },
]);

describe("commitRuleRevisionDecision — branch/parent lineage guard", () => {
  it("rejects a parent revision that does not belong to the target branch", async () => {
    getBranchForRollback.mockResolvedValue({ workspace_id: "ws-1", workspace_slug: "default" });
    getRevisionForDraft.mockResolvedValue(null); // parent is not on branch-B (within this tenant)

    const result = await commitRuleRevisionDecision({
      branchId: "branch-B",
      parentRevisionId: "revision-from-branch-A",
      rulesPayload: VALID_PAYLOAD,
      workspaceSlug: "default",
    });

    expect(result).toEqual({ error: "Parent revision not found on this branch." });
    // The parent must be validated against (tenant, branch, revision) together.
    expect(getRevisionForDraft).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      branchId: "branch-B",
      revisionId: "revision-from-branch-A",
    });
  });

  it("does not reach the lineage guard when the branch itself is missing", async () => {
    getBranchForRollback.mockResolvedValue(null);
    getRevisionForDraft.mockClear();

    const result = await commitRuleRevisionDecision({
      branchId: "branch-missing",
      parentRevisionId: "rev-1",
      rulesPayload: VALID_PAYLOAD,
      workspaceSlug: "default",
    });

    expect(result).toEqual({ error: "Branch not found." });
    expect(getRevisionForDraft).not.toHaveBeenCalled();
  });
});
