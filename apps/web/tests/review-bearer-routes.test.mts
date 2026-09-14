import { beforeEach, describe, expect, it, vi } from "vitest";

// Approving and publishing over bearer auth. What these pin is the identity
// rule: the reviewer is the principal the token was issued to, and the request
// body has no say in it. A route that accepted an actor id would turn one key
// into every reviewer in the workspace.

const authenticateServiceTokenSpy = vi.fn();
const addApprovalDecisionSpy = vi.fn();
const publishRevisionDecisionSpy = vi.fn();
const getPublishReadinessSpy = vi.fn();
const runSimulationDecisionSpy = vi.fn();
const tokenReviewActorSpy = vi.fn((principalId: string) => `resolver:${principalId}`);

vi.mock("@/lib/service-tokens", () => ({ authenticateServiceToken: authenticateServiceTokenSpy }));

vi.mock("@/lib/domains/evidence/service", () => ({
  runSimulationDecision: runSimulationDecisionSpy,
}));

vi.mock("@/lib/domains/review/service", () => ({
  addApprovalDecision: addApprovalDecisionSpy,
  publishRevisionDecision: publishRevisionDecisionSpy,
  getPublishReadiness: getPublishReadinessSpy,
  tokenReviewActor: tokenReviewActorSpy,
}));

const { POST: submitApproval } = await import("../app/api/v1/approvals/route");
const { POST: publishRevision } = await import("../app/api/v1/policy/publishes/route");
const { GET: readiness } = await import("../app/api/v1/policy/publishes/readiness/route");
const { POST: runSimulation } = await import("../app/api/v1/simulations/route");

const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const REGULAR_TENANT = "11111111-1111-4111-8111-111111111111";

function authenticateAs(tenantId: string, principalId = "principal-security") {
  authenticateServiceTokenSpy.mockResolvedValue({
    ok: true,
    auth: { tenantId, workspaceId: "workspace-1", principalId, scopes: [], tokenId: "token-1" },
  });
}

function approvalRequest(body: unknown) {
  return new Request("http://localhost/api/v1/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function publishRequest(body: unknown) {
  return new Request("http://localhost/api/v1/policy/publishes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  addApprovalDecisionSpy.mockResolvedValue({ ok: true });
  publishRevisionDecisionSpy.mockResolvedValue({ artifactHash: "sha256:abc" });
  runSimulationDecisionSpy.mockResolvedValue({
    runId: "run-1",
    branchId: "branch-1",
    revisionId: "rev-1",
    total: 12,
    newlyDenied: 1,
    newlyAllowed: 0,
    unchanged: 11,
  });
  getPublishReadinessSpy.mockResolvedValue({
    status: "READY",
    blockingReasons: [],
    requiredRoles: ["Security"],
    approvals: [],
    verificationRequired: false,
  });
});

describe("POST /api/v1/approvals", () => {
  it("requires the approvals:write scope", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({
      ok: false,
      error: "Token is missing approvals:write scope.",
    });

    const response = await submitApproval(
      approvalRequest({ revisionId: "rev-1", role: "Security", approvalStatus: "APPROVED" }),
    );

    expect(response.status).toBe(401);
    expect(authenticateServiceTokenSpy).toHaveBeenCalledWith(expect.anything(), "approvals:write");
  });

  it("reviews as the token's own principal, never one named in the body", async () => {
    authenticateAs(REGULAR_TENANT, "principal-security");

    const response = await submitApproval(
      approvalRequest({
        revisionId: "rev-1",
        role: "Security",
        approvalStatus: "APPROVED",
        // A caller trying to approve as somebody else.
        actorId: "principal-platform",
      }),
    );

    expect(response.status).toBe(200);
    expect(tokenReviewActorSpy).toHaveBeenCalledWith("principal-security");
    expect(addApprovalDecisionSpy).toHaveBeenCalledWith(
      { revisionId: "rev-1", role: "Security", approvalStatus: "APPROVED", note: null },
      { tenantId: REGULAR_TENANT, workspaceId: "workspace-1" },
      "resolver:principal-security",
    );
  });

  it("refuses to write for the demo tenant, as the review console does", async () => {
    authenticateAs(DEMO_TENANT);

    const response = await submitApproval(
      approvalRequest({ revisionId: "rev-1", role: "Security", approvalStatus: "APPROVED" }),
    );

    expect(response.status).toBe(403);
    expect(addApprovalDecisionSpy).not.toHaveBeenCalled();
  });

  it("separates a missing revision from a refused decision", async () => {
    authenticateAs(REGULAR_TENANT);

    addApprovalDecisionSpy.mockResolvedValueOnce({ error: "Revision not found." });
    const missing = await submitApproval(
      approvalRequest({ revisionId: "rev-x", role: "Security", approvalStatus: "APPROVED" }),
    );
    expect(missing.status).toBe(404);

    addApprovalDecisionSpy.mockResolvedValueOnce({
      error: "Actor Seed Security Reviewer cannot review as Platform.",
    });
    const refused = await submitApproval(
      approvalRequest({ revisionId: "rev-1", role: "Platform", approvalStatus: "APPROVED" }),
    );
    expect(refused.status).toBe(422);
  });
});

describe("POST /api/v1/policy/publishes", () => {
  it("requires the publish:write scope", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({
      ok: false,
      error: "Token is missing publish:write scope.",
    });

    const response = await publishRevision(
      publishRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(401);
    expect(authenticateServiceTokenSpy).toHaveBeenCalledWith(expect.anything(), "publish:write");
  });

  it("publishes through the same domain path the review console uses", async () => {
    authenticateAs(REGULAR_TENANT, "principal-platform");

    const response = await publishRevision(
      publishRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ artifactHash: "sha256:abc" });
    expect(publishRevisionDecisionSpy).toHaveBeenCalledWith(
      { branchId: "branch-1", revisionId: "rev-1" },
      { tenantId: REGULAR_TENANT, workspaceId: "workspace-1" },
      "resolver:principal-platform",
    );
  });

  it("answers 422 with the blocking reason when the revision is not ready", async () => {
    authenticateAs(REGULAR_TENANT);
    publishRevisionDecisionSpy.mockResolvedValueOnce({
      error: "Publish is blocked: missing approval from Security.",
    });

    const response = await publishRevision(
      publishRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "Publish is blocked: missing approval from Security.",
    });
  });

  it("refuses to publish for the demo tenant", async () => {
    authenticateAs(DEMO_TENANT);

    const response = await publishRevision(
      publishRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(403);
    expect(publishRevisionDecisionSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/policy/publishes/readiness", () => {
  it("reads with approvals:read and writes nothing", async () => {
    authenticateAs(REGULAR_TENANT);

    const response = await readiness(
      new Request(
        "http://localhost/api/v1/policy/publishes/readiness?branchId=branch-1&revisionId=rev-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(authenticateServiceTokenSpy).toHaveBeenCalledWith(expect.anything(), "approvals:read");
    await expect(response.json()).resolves.toMatchObject({ status: "READY" });
    expect(publishRevisionDecisionSpy).not.toHaveBeenCalled();
  });

  it("requires both identifiers", async () => {
    authenticateAs(REGULAR_TENANT);

    const response = await readiness(
      new Request("http://localhost/api/v1/policy/publishes/readiness?branchId=branch-1"),
    );

    expect(response.status).toBe(400);
  });
});

describe("POST /api/v1/simulations", () => {
  function simulationRequest(body: unknown) {
    return new Request("http://localhost/api/v1/simulations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("requires the simulation:run scope", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({
      ok: false,
      error: "Token is missing simulation:run scope.",
    });

    const response = await runSimulation(
      simulationRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(401);
    expect(authenticateServiceTokenSpy).toHaveBeenCalledWith(expect.anything(), "simulation:run");
  });

  it("attributes the run to the token's principal", async () => {
    authenticateAs(REGULAR_TENANT, "principal-platform");

    const response = await runSimulation(
      simulationRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ runId: "run-1", newlyDenied: 1 });
    expect(runSimulationDecisionSpy).toHaveBeenCalledWith(
      { branchId: "branch-1", revisionId: "rev-1" },
      { tenantId: REGULAR_TENANT, workspaceId: "workspace-1", actorId: "principal-platform" },
    );
  });

  it("separates nothing-to-replay from a failure", async () => {
    authenticateAs(REGULAR_TENANT);
    runSimulationDecisionSpy.mockResolvedValueOnce({
      error: "No evidence or revision data available to simulate against.",
    });

    const empty = await runSimulation(
      simulationRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );
    expect(empty.status).toBe(422);

    runSimulationDecisionSpy.mockResolvedValueOnce({
      error: "An unexpected error occurred during simulation.",
    });
    const failed = await runSimulation(
      simulationRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );
    expect(failed.status).toBe(500);
  });

  it("refuses to replay for the demo tenant", async () => {
    authenticateAs(DEMO_TENANT);

    const response = await runSimulation(
      simulationRequest({ branchId: "branch-1", revisionId: "rev-1" }),
    );

    expect(response.status).toBe(403);
    expect(runSimulationDecisionSpy).not.toHaveBeenCalled();
  });
});
