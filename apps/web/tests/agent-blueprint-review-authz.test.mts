import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

// Regression coverage for the Blueprint reviewer-authorization slug fix. The
// approvals and rollback routes previously gated on a hardcoded "workspace-demo"
// slug, which denied any workspace-scoped reviewer (allowedWorkspaceSlugs set to
// their real slug rather than "ALL") in a non-demo workspace. They now resolve
// the Blueprint's real governing slug and authorize against it. These tests keep
// the real canActorReviewRole / requireActorAdminWorkspace and only stub identity
// + the DB-backed slug lookup, so they exercise the actual authorization decision.

const getAuthSessionSpy = vi.fn();
const getActiveScopeSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const blueprintWorkspaceScopeSpy = vi.fn();
const getBlueprintSpy = vi.fn();
const getApprovalsSpy = vi.fn().mockResolvedValue([]);
const submitApprovalSpy = vi.fn().mockResolvedValue(true);
const rollbackSpy = vi.fn();
const setRevisionStatusSpy = vi.fn();
const createRevisionSpy = vi.fn();
const publishRevisionSpy = vi.fn();
const createBlueprintSpy = vi.fn();
const resolveWorkspaceForActionSpy = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));
vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeSpy }));
vi.mock("@/lib/demo-guard", () => ({ verifyWriteAccess: () => ({ allowed: true }) }));
vi.mock("@/lib/repositories/operations-log", () => ({ appendOperationsLog: async () => {} }));

// Keep the real reviewer-role predicates; only stub identity resolution.
vi.mock("@/lib/actors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actors")>();
  return { ...actual, findActorById: findActorByIdSpy };
});

vi.mock("@/lib/domains/agent-blueprints/service", () => ({
  getAgentBlueprint: getBlueprintSpy,
  getAgentBlueprintApprovals: getApprovalsSpy,
  getAgentBlueprintWorkspaceScope: blueprintWorkspaceScopeSpy,
  submitBlueprintApproval: submitApprovalSpy,
  rollbackAgentBlueprint: rollbackSpy,
  setAgentBlueprintRevisionStatus: setRevisionStatusSpy,
  createAgentBlueprintRevision: createRevisionSpy,
  createAgentBlueprint: createBlueprintSpy,
  listAgentBlueprints: vi.fn().mockResolvedValue([]),
  parseAgentBlueprintDefinition: vi.fn((definition) => ({ definition })),
  publishBlueprintRevision: publishRevisionSpy,
}));

vi.mock("@/lib/repositories/workspace/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/workspace/core")>();
  return { ...actual, resolveWorkspaceForAction: resolveWorkspaceForActionSpy };
});

const { POST: approvalsPost } =
  await import("../app/api/agent-blueprints/[id]/revisions/[revisionId]/approvals/route");
const { GET: approvalsGet } =
  await import("../app/api/agent-blueprints/[id]/revisions/[revisionId]/approvals/route");
const { POST: rollbackPost } = await import("../app/api/agent-blueprints/[id]/rollback/route");
const { PATCH: lifecyclePatch } = await import("../app/api/agent-blueprints/[id]/route");
const { POST: blueprintPost } = await import("../app/api/agent-blueprints/[id]/route");
const { POST: collectionPost } = await import("../app/api/agent-blueprints/route");

function scopedActor(overrides: Record<string, unknown> = {}) {
  return {
    id: "principal-1",
    name: "Scoped Reviewer",
    email: null,
    reviewerRoles: ["Security"],
    publishScopes: [],
    allowedEnvironments: "ALL",
    allowedWorkspaceSlugs: ["acme-prod"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  submitApprovalSpy.mockResolvedValue(true);
  getBlueprintSpy.mockResolvedValue({ revisions: [{ id: "rev-1", status: "IN_REVIEW" }] });
  setRevisionStatusSpy.mockResolvedValue({ id: "rev-1" });
  createRevisionSpy.mockResolvedValue({ id: "rev-2" });
  publishRevisionSpy.mockResolvedValue({ revision: { id: "rev-1" } });
  createBlueprintSpy.mockResolvedValue({ id: "bp-new" });
  resolveWorkspaceForActionSpy.mockResolvedValue({ id: "ws-1", slug: "acme-prod" });
  getAuthSessionSpy.mockResolvedValue({
    principalId: "principal-1",
    tenantId: "tenant-1",
    subject: "sub-1",
  });
  getActiveScopeSpy.mockResolvedValue({ tenantId: "tenant-1", workspaceId: "ws-1" });
});

describe("Blueprint approvals read route scopes revisions to the active workspace", () => {
  it("does not disclose approvals for a Blueprint outside the active workspace", async () => {
    getBlueprintSpy.mockResolvedValue(null);

    const response = await approvalsGet(
      new Request("http://localhost/api/agent-blueprints/bp-1/revisions/rev-1/approvals"),
      { params: Promise.resolve({ id: "bp-1", revisionId: "rev-1" }) },
    );

    expect(response.status).toBe(404);
    expect(getApprovalsSpy).not.toHaveBeenCalled();
  });
});

function approvalsRequest(body: unknown) {
  return createRouteRequest({ path: "/api/agent-blueprints/bp-1/revisions/rev-1/approvals", body });
}

describe("Blueprint approvals route authorizes against the real workspace slug", () => {
  it("rejects PENDING because reviewer decisions must be explicit", async () => {
    const response = await approvalsPost(
      approvalsRequest({ role: "Security", status: "PENDING" }),
      { params: Promise.resolve({ id: "bp-1", revisionId: "rev-1" }) },
    );

    expect(response.status).toBe(400);
    expect(submitApprovalSpy).not.toHaveBeenCalled();
  });

  it("allows a workspace-scoped reviewer to approve in their own (non-demo) workspace", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor());
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });

    const response = await approvalsPost(
      approvalsRequest({ role: "Security", status: "APPROVED" }),
      { params: Promise.resolve({ id: "bp-1", revisionId: "rev-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(blueprintWorkspaceScopeSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      blueprintId: "bp-1",
    });
    expect(submitApprovalSpy).toHaveBeenCalledOnce();
  });

  it("denies the reviewer when the Blueprint belongs to a workspace they are not assigned to", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor());
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "other-workspace",
    });

    const response = await approvalsPost(
      approvalsRequest({ role: "Security", status: "APPROVED" }),
      { params: Promise.resolve({ id: "bp-1", revisionId: "rev-1" }) },
    );

    expect(response.status).toBe(403);
    expect(submitApprovalSpy).not.toHaveBeenCalled();
  });

  it("does not write an approval through a different active workspace", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor());
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-2",
      workspace_slug: "acme-prod",
    });

    const response = await approvalsPost(
      approvalsRequest({ role: "Security", status: "APPROVED" }),
      { params: Promise.resolve({ id: "bp-1", revisionId: "rev-1" }) },
    );

    expect(response.status).toBe(404);
    expect(submitApprovalSpy).not.toHaveBeenCalled();
  });

  it("rejects approvals until the Blueprint revision has been submitted for review", async () => {
    getBlueprintSpy.mockResolvedValue({ revisions: [{ id: "rev-1", status: "DRAFT" }] });

    const response = await approvalsPost(
      approvalsRequest({ role: "Security", status: "APPROVED" }),
      { params: Promise.resolve({ id: "bp-1", revisionId: "rev-1" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Submit the Blueprint revision for review before recording approvals.",
    });
    expect(submitApprovalSpy).not.toHaveBeenCalled();
  });
});

describe("Blueprint lifecycle mirrors the policy authoring/publish split", () => {
  function patchRequest(status: string) {
    return createRouteRequest({
      path: "/api/agent-blueprints/bp-1",
      method: "PATCH",
      body: { revisionId: "rev-1", status },
    });
  }

  it("lets any workspace member with write access submit a draft for review", async () => {
    // Security reviewer: not an admin, no publish scope — submitting is authoring.
    findActorByIdSpy.mockResolvedValue(scopedActor());
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });

    const response = await lifecyclePatch(patchRequest("IN_REVIEW"), {
      params: Promise.resolve({ id: "bp-1" }),
    });

    expect(response.status).toBe(200);
    expect(setRevisionStatusSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      workspaceId: "ws-1",
      blueprintId: "bp-1",
      revisionId: "rev-1",
      status: "IN_REVIEW",
    });
  });

  it("denies publish to an actor without the workspace publish scope", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor({ publishScopes: [] }));
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });

    const response = await lifecyclePatch(patchRequest("PUBLISHED"), {
      params: Promise.resolve({ id: "bp-1" }),
    });

    expect(response.status).toBe(403);
    expect(publishRevisionSpy).not.toHaveBeenCalled();
  });

  it("allows publish for an actor holding the workspace publish scope", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor({ publishScopes: ["WORKSPACE"] }));
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });

    const response = await lifecyclePatch(patchRequest("PUBLISHED"), {
      params: Promise.resolve({ id: "bp-1" }),
    });

    expect(response.status).toBe(200);
    expect(publishRevisionSpy).toHaveBeenCalledOnce();
  });
});

describe("Appending a Blueprint revision needs only workspace write access", () => {
  function appendRequest(body: unknown) {
    return createRouteRequest({ path: "/api/agent-blueprints/bp-1", body });
  }

  it("allows a non-admin workspace member to append a revision", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor()); // Security reviewer, not an admin
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });

    const response = await blueprintPost(
      appendRequest({ definition: {}, message: "Tighten session budget" }),
      { params: Promise.resolve({ id: "bp-1" }) },
    );

    expect(response.status).toBe(201);
    expect(createRevisionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workspaceId: "ws-1",
        blueprintId: "bp-1",
        authorId: "principal-1",
        message: "Tighten session budget",
      }),
    );
  });

  it("rejects appending to a Blueprint outside the active workspace", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor());
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-2",
      workspace_slug: "acme-prod",
    });

    const response = await blueprintPost(appendRequest({ definition: {} }), {
      params: Promise.resolve({ id: "bp-1" }),
    });

    expect(response.status).toBe(404);
    expect(createRevisionSpy).not.toHaveBeenCalled();
  });
});

describe("Creating a Blueprint requires a workspace admin, like a policy branch", () => {
  function createRequest(body: unknown) {
    return createRouteRequest({ path: "/api/agent-blueprints", body });
  }

  it("denies a non-admin workspace member", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor());

    const response = await collectionPost(
      createRequest({ name: "Refund agent", agentId: "refunds", definition: {} }),
    );

    expect(response.status).toBe(403);
    expect(createBlueprintSpy).not.toHaveBeenCalled();
  });

  it("allows a workspace admin", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor({ reviewerRoles: ["Admin"] }));

    const response = await collectionPost(
      createRequest({ name: "Refund agent", agentId: "refunds", definition: {} }),
    );

    expect(response.status).toBe(201);
    expect(createBlueprintSpy).toHaveBeenCalled();
  });
});

describe("Blueprint rollback route authorizes admin against the real workspace slug", () => {
  it("allows a workspace-scoped admin to roll back in their own (non-demo) workspace", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor({ reviewerRoles: ["Admin"] }));
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });
    rollbackSpy.mockResolvedValue({ id: "rev-0", definitionHash: "hash" });

    const response = await rollbackPost(
      new Request("http://localhost/api/agent-blueprints/bp-1/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetRevisionId: "rev-0" }),
      }),
      { params: Promise.resolve({ id: "bp-1" }) },
    );

    expect(response.status).toBe(200);
    expect(rollbackSpy).toHaveBeenCalledOnce();
  });

  it("denies a non-admin scoped reviewer even in their own workspace", async () => {
    findActorByIdSpy.mockResolvedValue(scopedActor({ reviewerRoles: ["Security"] }));
    blueprintWorkspaceScopeSpy.mockResolvedValue({
      workspace_id: "ws-1",
      workspace_slug: "acme-prod",
    });

    const response = await rollbackPost(
      new Request("http://localhost/api/agent-blueprints/bp-1/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetRevisionId: "rev-0" }),
      }),
      { params: Promise.resolve({ id: "bp-1" }) },
    );

    expect(response.status).toBe(403);
    expect(rollbackSpy).not.toHaveBeenCalled();
  });
});
