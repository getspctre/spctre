import { beforeEach, describe, expect, it, vi } from "vitest";

// Who may record a decision on a policy revision, and what happens when they
// may not.
//
// This runs for two callers now — the review console through a session, and
// POST /api/v1/approvals through a service token — which share one code path
// and differ only in the actor resolver they pass. The route tests cover the
// HTTP envelope; these cover the decisions underneath it, including the two
// refusals that must leave an authorization-denial event behind rather than
// failing quietly.

const getRevisionWorkspaceScopeSpy = vi.fn();
const upsertApprovalForRevisionSpy = vi.fn();
const insertAuthorizationDenialEventSpy = vi.fn();
const canActorReviewRoleSpy = vi.fn();

vi.mock("@/lib/repositories/policy", () => ({
  getApprovalById: vi.fn(),
  getRevisionWorkspaceScope: getRevisionWorkspaceScopeSpy,
  upsertApprovalForRevision: upsertApprovalForRevisionSpy,
}));
vi.mock("@/lib/repositories/workspace", () => ({
  insertAuthorizationDenialEvent: insertAuthorizationDenialEventSpy,
}));
vi.mock("@/lib/repositories/policy/review", () => ({ listPendingApprovalQueue: vi.fn() }));
vi.mock("@/lib/actors", () => ({ canActorReviewRole: canActorReviewRoleSpy }));
vi.mock("@/lib/approval-config", () => ({
  ALL_REVIEWER_ROLES: ["Security", "Platform", "Legal", "Ops", "Admin"],
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));

const { addApprovalDecision } = await import("../lib/domains/review/approvals");

const TENANT = "11111111-1111-4111-8111-111111111111";
const SCOPE = { tenantId: TENANT, workspaceId: "workspace-fallback" };
const REVISION = "rev-1";

const ACTOR = { id: "principal-security", name: "Security Reviewer" };

/** A resolver standing in for a session, or for a token's own principal. */
const resolves = (principalId: string | null, actor: typeof ACTOR | null) => async () => ({
  principalId,
  actor,
});

function validInput(overrides: Partial<Parameters<typeof addApprovalDecision>[0]> = {}) {
  return {
    revisionId: REVISION,
    role: "Security",
    approvalStatus: "APPROVED",
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRevisionWorkspaceScopeSpy.mockResolvedValue({
    workspace_id: "workspace-of-revision",
    workspace_slug: "acme",
  });
  canActorReviewRoleSpy.mockReturnValue({ allowed: true });
  upsertApprovalForRevisionSpy.mockResolvedValue(undefined);
  insertAuthorizationDenialEventSpy.mockResolvedValue(undefined);
});

describe("input the domain refuses before touching anything", () => {
  it.each([
    ["missing revision", { revisionId: "" }, "Review action is unavailable."],
    ["missing role", { role: "" }, "Review action is unavailable."],
    ["missing status", { approvalStatus: "" }, "Review action is unavailable."],
    ["unknown reviewer role", { role: "Janitor" }, "Reviewer role is invalid."],
    ["unknown status", { approvalStatus: "RUBBER_STAMPED" }, "Approval status is invalid."],
  ])("refuses %s", async (_label, overrides, error) => {
    const result = await addApprovalDecision(
      validInput(overrides),
      SCOPE,
      resolves(ACTOR.id, ACTOR),
    );

    expect(result).toEqual({ error });
    expect(getRevisionWorkspaceScopeSpy).not.toHaveBeenCalled();
    expect(upsertApprovalForRevisionSpy).not.toHaveBeenCalled();
  });

  it.each(["APPROVED", "CHANGES_REQUESTED", "PENDING"])("accepts the %s status", async (status) => {
    const result = await addApprovalDecision(
      validInput({ approvalStatus: status }),
      SCOPE,
      resolves(ACTOR.id, ACTOR),
    );

    expect(result).toEqual({ ok: true });
    expect(upsertApprovalForRevisionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ approvalStatus: status }),
    );
  });
});

describe("resolving the acting reviewer", () => {
  it("looks the actor up in the revision's workspace, not the caller's", async () => {
    // A service token carries its own workspace, which need not be the one the
    // revision belongs to. Grants are per workspace, so resolving in the wrong
    // one would admit or refuse the wrong person.
    const resolver = vi.fn(async () => ({ principalId: ACTOR.id, actor: ACTOR }));

    await addApprovalDecision(validInput(), SCOPE, resolver);

    expect(resolver).toHaveBeenCalledWith({
      workspaceId: "workspace-of-revision",
      tenantId: TENANT,
    });
  });

  it("falls back to the caller's workspace when the revision names none", async () => {
    getRevisionWorkspaceScopeSpy.mockResolvedValue({ workspace_id: null, workspace_slug: null });
    const resolver = vi.fn(async () => ({ principalId: ACTOR.id, actor: ACTOR }));

    await addApprovalDecision(validInput(), SCOPE, resolver);

    expect(resolver).toHaveBeenCalledWith({ workspaceId: "workspace-fallback", tenantId: TENANT });
  });

  it("reports a revision that does not exist without resolving anyone", async () => {
    getRevisionWorkspaceScopeSpy.mockResolvedValue(null);
    const resolver = vi.fn();

    const result = await addApprovalDecision(validInput(), SCOPE, resolver);

    expect(result).toEqual({ error: "Revision not found." });
    expect(resolver).not.toHaveBeenCalled();
    expect(insertAuthorizationDenialEventSpy).not.toHaveBeenCalled();
  });
});

describe("refusals leave evidence", () => {
  it("records the denial when the principal holds no grant here", async () => {
    // How a service token whose principal has no grant in the revision's
    // workspace arrives. The principal is known even though the actor is not,
    // so the denial names who was refused.
    const result = await addApprovalDecision(
      validInput(),
      SCOPE,
      resolves("principal-with-no-grant", null),
    );

    expect(result).toEqual({
      error: "No permission grants are configured for the acting principal.",
    });
    expect(upsertApprovalForRevisionSpy).not.toHaveBeenCalled();
    expect(insertAuthorizationDenialEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approval.write",
        resourceType: "policy_revision",
        resourceId: REVISION,
        principalId: "principal-with-no-grant",
        workspaceId: "workspace-of-revision",
        tenantId: TENANT,
      }),
    );
  });

  it("records the denial when the reviewer does not hold the role", async () => {
    canActorReviewRoleSpy.mockReturnValue({
      allowed: false,
      reason: "Actor Security Reviewer cannot review as Platform.",
    });

    const result = await addApprovalDecision(
      validInput({ role: "Platform" }),
      SCOPE,
      resolves(ACTOR.id, ACTOR),
    );

    expect(result).toEqual({ error: "Actor Security Reviewer cannot review as Platform." });
    expect(upsertApprovalForRevisionSpy).not.toHaveBeenCalled();
    expect(insertAuthorizationDenialEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approval.write",
        reason: "Actor Security Reviewer cannot review as Platform.",
        principalId: ACTOR.id,
      }),
    );
  });

  it("still refuses when the role check gives no reason", async () => {
    canActorReviewRoleSpy.mockReturnValue({ allowed: false });

    const result = await addApprovalDecision(validInput(), SCOPE, resolves(ACTOR.id, ACTOR));

    expect(result).toEqual({ error: "Review is not allowed." });
    expect(upsertApprovalForRevisionSpy).not.toHaveBeenCalled();
  });

  it("checks the role against the revision's own workspace slug", async () => {
    await addApprovalDecision(validInput(), SCOPE, resolves(ACTOR.id, ACTOR));

    expect(canActorReviewRoleSpy).toHaveBeenCalledWith(ACTOR, "acme", "Security");
  });
});

describe("recording the decision", () => {
  it("writes it against the resolved actor, never one named by the caller", async () => {
    // There is no actor field on this path and there must not be: the reviewer
    // is whoever the resolver produced.
    const result = await addApprovalDecision(
      validInput({ note: "Looks right to me." }),
      SCOPE,
      resolves(ACTOR.id, ACTOR),
    );

    expect(result).toEqual({ ok: true });
    expect(upsertApprovalForRevisionSpy).toHaveBeenCalledWith({
      tenantId: TENANT,
      revisionId: REVISION,
      actorId: ACTOR.id,
      role: "Security",
      approvalStatus: "APPROVED",
      note: "Looks right to me.",
    });
    expect(insertAuthorizationDenialEventSpy).not.toHaveBeenCalled();
  });
});
