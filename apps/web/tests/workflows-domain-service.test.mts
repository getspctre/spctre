import { beforeEach, describe, expect, it, vi } from "vitest";

// Approval workflows decide how many reviewers a policy revision needs and in
// which roles. Editing one changes what "approved" means for every future
// publish in its scope, so the branches worth pinning are the ones that decide
// *which* workflow is edited, what survives the edit, and what happens to
// approvals already collected under the old shape.
//
// The tag round-trip is the subtle one: two feature flags are stored as risk
// tags alongside tags this surface does not own, so a save has to rewrite its
// own two without discarding the rest.

const requireAdminActorSpy = vi.fn();
const checkWriteAccessSpy = vi.fn();
const verifyWorkspaceForWorkflowSpy = vi.fn();
const getExistingWorkflowForScopeSpy = vi.fn();
const getWorkflowRiskTagsSpy = vi.fn();
const upsertWorkflowConfigSpy = vi.fn();
const getNextWorkflowRuleSequenceSpy = vi.fn();
const upsertWorkflowRuleSpy = vi.fn();
const deleteActiveApprovalsSpy = vi.fn();
const insertWorkflowAuditEventSpy = vi.fn();
const disableWorkflowConfigSpy = vi.fn();
const deleteWorkflowRuleSpy = vi.fn();

vi.mock("@/lib/domains/shared/guard", () => ({
  requireAdminActor: requireAdminActorSpy,
  checkWriteAccess: checkWriteAccessSpy,
}));
vi.mock("@/lib/repositories/approval-workflow", () => ({
  verifyWorkspaceForWorkflow: verifyWorkspaceForWorkflowSpy,
  getExistingWorkflowForScope: getExistingWorkflowForScopeSpy,
  getWorkflowRiskTags: getWorkflowRiskTagsSpy,
  upsertWorkflowConfig: upsertWorkflowConfigSpy,
  getNextWorkflowRuleSequence: getNextWorkflowRuleSequenceSpy,
  upsertWorkflowRule: upsertWorkflowRuleSpy,
  deleteActiveApprovals: deleteActiveApprovalsSpy,
  insertWorkflowAuditEvent: insertWorkflowAuditEventSpy,
  disableWorkflowConfig: disableWorkflowConfigSpy,
  deleteWorkflowRule: deleteWorkflowRuleSpy,
  listApprovalWorkflows: vi.fn(),
  getApprovalWorkflowForContext: vi.fn(),
  approvalRulesFromWorkflow: vi.fn(),
}));
vi.mock("@/lib/repositories/members", () => ({ listTenantWorkspaces: vi.fn() }));
vi.mock("@/lib/auth-session", () => ({ getAuthSession: vi.fn() }));
vi.mock("@/lib/actors", () => ({ findActorById: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getWorkspaceContext: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const service = await import("../lib/domains/workflows/service");

const TENANT = "tenant-1";
const VERIFICATION_TAG = "verification:require-agt";
const IMMEDIATE_PACK_TAG = "pack:allow-immediate-publish";

/** A valid save, which individual tests override one field at a time. */
function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    name: "Two-role review",
    workspaceId: "workspace-1",
    reviewMode: "PARALLEL",
    role: "Security",
    requiredCount: "1",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") data.set(key, value);
  }
  // The parser reads repeated `eligibleRole` entries, singular, as a checkbox
  // group does.
  for (const role of (overrides.eligibleRoles ?? "Security").split(",").filter(Boolean)) {
    data.append("eligibleRole", role);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminActorSpy.mockResolvedValue({
    session: { tenantId: TENANT, principalId: "principal-1" },
    workspaceId: "workspace-1",
  });
  checkWriteAccessSpy.mockReturnValue({ allowed: true });
  verifyWorkspaceForWorkflowSpy.mockResolvedValue(true);
  getExistingWorkflowForScopeSpy.mockResolvedValue(null);
  getWorkflowRiskTagsSpy.mockResolvedValue([]);
  upsertWorkflowConfigSpy.mockResolvedValue("workflow-1");
  getNextWorkflowRuleSequenceSpy.mockResolvedValue(1);
  upsertWorkflowRuleSpy.mockResolvedValue(undefined);
  deleteActiveApprovalsSpy.mockResolvedValue(0);
  insertWorkflowAuditEventSpy.mockResolvedValue(undefined);
});

describe("who may edit a workflow", () => {
  it("refuses a non-admin before reading anything", async () => {
    requireAdminActorSpy.mockResolvedValue({ error: "Admin permission is required." });

    const result = await service.upsertApprovalWorkflowDecision(form());

    expect(result).toEqual({ error: "Admin permission is required." });
    expect(upsertWorkflowConfigSpy).not.toHaveBeenCalled();
  });

  it("refuses a demo tenant", async () => {
    checkWriteAccessSpy.mockReturnValue({ error: "Read-only in Demo Mode." });

    const result = await service.upsertApprovalWorkflowDecision(form());

    expect(result).toEqual({ error: "Read-only in Demo Mode." });
    expect(upsertWorkflowConfigSpy).not.toHaveBeenCalled();
  });

  it("refuses a workspace the tenant cannot reach", async () => {
    verifyWorkspaceForWorkflowSpy.mockResolvedValue(false);

    const result = await service.upsertApprovalWorkflowDecision(form());

    expect(result).toEqual({ error: "Selected workspace is not available." });
    expect(upsertWorkflowConfigSpy).not.toHaveBeenCalled();
  });
});

describe("the form the editor submits", () => {
  it.each([
    [{ name: "" }, "Workflow name is required."],
    [{ role: "Janitor" }, "Select a reviewer role for the rule."],
    [{ requiredCount: "0" }, "Required approver count must be between 1 and 10."],
    [{ requiredCount: "11" }, "Required approver count must be between 1 and 10."],
    [{ requiredCount: "not-a-number" }, "Required approver count must be between 1 and 10."],
    [{ eligibleRoles: "" }, "Select at least one eligible reviewer role."],
    [{ eligibleRoles: "Janitor" }, "Select at least one eligible reviewer role."],
  ])("refuses %j", async (overrides, error) => {
    const result = await service.upsertApprovalWorkflowDecision(form(overrides));

    expect(result).toEqual({ error });
    expect(upsertWorkflowConfigSpy).not.toHaveBeenCalled();
  });

  it("accepts the boundaries of the approver count", async () => {
    for (const requiredCount of ["1", "10"]) {
      const result = await service.upsertApprovalWorkflowDecision(form({ requiredCount }));
      expect(result).toMatchObject({ ok: true });
    }
  });

  it("treats TENANT as the tenant-wide scope, not a workspace id", async () => {
    await service.upsertApprovalWorkflowDecision(form({ workspaceId: "TENANT" }));

    expect(verifyWorkspaceForWorkflowSpy).not.toHaveBeenCalled();
    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: null }),
    );
  });

  it("falls back to PARALLEL for a review mode it does not recognize", async () => {
    await service.upsertApprovalWorkflowDecision(form({ reviewMode: "TELEPATHIC" }));

    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reviewMode: "PARALLEL" }),
    );
  });
});

describe("which workflow the save lands on", () => {
  it("updates the workflow already covering that scope rather than creating a second", async () => {
    // Two workflows for one scope would make "which rules apply" ambiguous.
    getExistingWorkflowForScopeSpy.mockResolvedValue("workflow-existing");

    await service.upsertApprovalWorkflowDecision(form());

    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "workflow-existing" }),
    );
    expect(insertWorkflowAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "WORKFLOW_UPDATED" }),
    );
  });

  it("records a creation when no workflow covered the scope", async () => {
    await service.upsertApprovalWorkflowDecision(form());

    expect(insertWorkflowAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "WORKFLOW_CREATED" }),
    );
  });

  it("does not look for an existing workflow when the editor named one", async () => {
    await service.upsertApprovalWorkflowDecision(form({ workflowId: "workflow-explicit" }));

    expect(getExistingWorkflowForScopeSpy).not.toHaveBeenCalled();
    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "workflow-explicit" }),
    );
  });

  it("reports a save the repository refused", async () => {
    upsertWorkflowConfigSpy.mockResolvedValue(null);

    const result = await service.upsertApprovalWorkflowDecision(form());

    expect(result).toEqual({ error: "Unable to save approval workflow." });
    expect(upsertWorkflowRuleSpy).not.toHaveBeenCalled();
  });
});

describe("the two flags stored as risk tags", () => {
  it("keeps tags this surface does not own", async () => {
    // Risk tags are a shared column. Rewriting the whole list from the form
    // would silently drop anything set elsewhere.
    getWorkflowRiskTagsSpy.mockResolvedValue(["incident-mode", VERIFICATION_TAG]);

    await service.upsertApprovalWorkflowDecision(
      form({ workflowId: "workflow-1", requireVerification: "on" }),
    );

    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ riskTags: ["incident-mode", VERIFICATION_TAG] }),
    );
  });

  it("clears its own tag when the box is unchecked", async () => {
    getWorkflowRiskTagsSpy.mockResolvedValue(["incident-mode", VERIFICATION_TAG]);

    await service.upsertApprovalWorkflowDecision(form({ workflowId: "workflow-1" }));

    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ riskTags: ["incident-mode"] }),
    );
  });

  it("carries both flags when both are set", async () => {
    await service.upsertApprovalWorkflowDecision(
      form({
        workflowId: "workflow-1",
        requireVerification: "on",
        allowImmediatePackPublish: "on",
      }),
    );

    expect(upsertWorkflowConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({ riskTags: [VERIFICATION_TAG, IMMEDIATE_PACK_TAG] }),
    );
  });

  it("reads no tags for a workflow that does not exist yet", async () => {
    await service.upsertApprovalWorkflowDecision(form());

    expect(getWorkflowRiskTagsSpy).not.toHaveBeenCalled();
  });
});

describe("approvals already collected", () => {
  it("clears them for the scope, so nothing is approved under the old shape", async () => {
    // A revision approved under a one-role workflow must not stay approved when
    // the workflow becomes two-role; the count it satisfied no longer exists.
    deleteActiveApprovalsSpy.mockResolvedValue(4);

    const result = await service.upsertApprovalWorkflowDecision(form());

    expect(deleteActiveApprovalsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, workspaceId: "workspace-1" }),
    );
    expect(insertWorkflowAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ refreshedItems: 4 }) }),
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe("disabling and removing", () => {
  it("refuses to disable without admin", async () => {
    requireAdminActorSpy.mockResolvedValue({ error: "Admin permission is required." });
    const data = new FormData();
    data.set("workflowId", "workflow-1");

    const result = await service.disableApprovalWorkflowDecision(data);

    expect(result).toEqual({ error: "Admin permission is required." });
    expect(disableWorkflowConfigSpy).not.toHaveBeenCalled();
  });

  it("refuses to remove a rule without admin", async () => {
    requireAdminActorSpy.mockResolvedValue({ error: "Admin permission is required." });
    const data = new FormData();
    data.set("workflowId", "workflow-1");
    data.set("ruleId", "rule-1");

    const result = await service.removeApprovalWorkflowRuleDecision(data);

    expect(result).toEqual({ error: "Admin permission is required." });
    expect(deleteWorkflowRuleSpy).not.toHaveBeenCalled();
  });

  it("refuses both on a demo tenant", async () => {
    checkWriteAccessSpy.mockReturnValue({ error: "Read-only in Demo Mode." });
    const data = new FormData();
    data.set("workflowId", "workflow-1");
    data.set("ruleId", "rule-1");

    await expect(service.disableApprovalWorkflowDecision(data)).resolves.toEqual({
      error: "Read-only in Demo Mode.",
    });
    await expect(service.removeApprovalWorkflowRuleDecision(data)).resolves.toEqual({
      error: "Read-only in Demo Mode.",
    });
    expect(disableWorkflowConfigSpy).not.toHaveBeenCalled();
    expect(deleteWorkflowRuleSpy).not.toHaveBeenCalled();
  });
});
