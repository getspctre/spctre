import { describe, expect, it, vi } from "vitest";

const getAuthSessionSpy = vi.fn();
const getWorkspaceContextSpy = vi.fn();
const getLatestPublishedBundleSpy = vi.fn();
const listRuntimeEvidenceSpy = vi.fn();
const listResolvedEscalationsForRevisionSpy = vi.fn();
const listVerificationResultsSpy = vi.fn();
const authenticateServiceTokenSpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/workspace/scope", () => ({ getActiveScope: getWorkspaceContextSpy }));

vi.mock("@/lib/repositories/evidence", () => ({ listRuntimeEvidence: listRuntimeEvidenceSpy }));

vi.mock("@/lib/repositories/gateway", () => ({
  getGatewayOutcomesForDecisions: vi.fn().mockResolvedValue(new Map()),
  listResolvedEscalationsForRevision: listResolvedEscalationsForRevisionSpy,
}));

vi.mock("@/lib/repositories/policy", () => ({
  getLatestPublishedBundle: getLatestPublishedBundleSpy,
}));

vi.mock("@/lib/repositories/verification", () => ({
  listVerificationResults: listVerificationResultsSpy,
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: authenticateServiceTokenSpy,
  hasBearerToken: (request: Request) => (request.headers.get("authorization") ?? "").startsWith("Bearer "),
}));

const route = await import("../app/api/evidence/export/route");

describe("evidence export route", () => {
  const evidenceExportAuth = {
    ok: true as const,
    auth: {
      tokenId: "token-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      principalId: "agent-1",
      connector: "acquisition-scout",
      scopes: ["evidence:export"],
      evidenceExportGrants: [
        { revisionId: "revision-1", notBefore: "2026-01-01T00:00:00.000Z" },
      ],
    },
  };

  it("rejects a caller-supplied connector that disagrees with token identity", async () => {
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    const response = await route.GET(
      new Request("http://localhost:3000/api/evidence/export?connector=acquisition-author", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a bearer request without an active connector-bound grant", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({
      ok: true,
      auth: { ...evidenceExportAuth.auth, connector: undefined, evidenceExportGrants: [] },
    });
    const response = await route.GET(
      new Request("http://localhost:3000/api/evidence/export", { headers: { authorization: "Bearer token" } }),
    );
    expect(response.status).toBe(401);
  });

  it("does not allow bearer tokens to mint AGT live-attestation packets", async () => {
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    const response = await route.GET(
      new Request("http://localhost:3000/api/evidence/export?format=agt-verification", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("scopes AGT verification packets to the published artifact", async () => {
    getAuthSessionSpy.mockResolvedValue({ principalId: "user-1", tenantId: "tenant-1" });
    getWorkspaceContextSpy.mockResolvedValue({ workspaceId: "workspace-1", tenantId: "tenant-1" });
    getLatestPublishedBundleSpy.mockResolvedValue({
      publishedAt: "2026-05-07T00:00:00.000Z",
      publishedBy: "user-1",
      publishId: "publish-1",
      branchId: "branch-1",
      revisionId: "revision-1",
      artifactHash: "sha256:current",
      bundle: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        branchId: "branch-1",
        revisionId: "revision-1",
        sourceFormat: "AGT_YAML",
        sourceHash: "sha256:source",
        artifactHash: "sha256:current",
        targetStacks: [],
        approvals: [],
        rules: [],
        generatedAt: "2026-05-07T00:00:00.000Z",
        metadata: {},
      },
    });
    listRuntimeEvidenceSpy.mockResolvedValue([
      evidenceRecord("decision-current", "sha256:current", "revision-1"),
      evidenceRecord("decision-context", "sha256:other", "revision-1"),
      evidenceRecord("decision-old", "sha256:old", "revision-old"),
    ]);
    listResolvedEscalationsForRevisionSpy.mockResolvedValue([]);
    listVerificationResultsSpy.mockResolvedValue([
      {
        id: "vr-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        revisionId: "revision-1",
        artifactHash: "sha256:current",
        verificationType: "AGT_VERIFY_EVIDENCE",
        outcome: "PASS",
        summary: {},
        runBy: "svc-ci",
        createdAt: "2026-06-10T00:00:00.000Z",
        agtVersion: "4.1.0",
        escrowSignerId: "did:example:escrow",
      },
    ]);

    const response = await route.GET(
      new Request("http://localhost:3000/api/evidence/export?format=agt-verification"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evidence.map((record: { decisionId: string }) => record.decisionId)).toEqual([
      "decision-current",
      "decision-context",
    ]);
    expect(body.provenance).toMatchObject({ artifactHash: "sha256:current", evidenceCount: 2 });
    expect(body.verificationResults[0]).toMatchObject({
      agtVersion: "4.1.0",
      escrowSignerId: "did:example:escrow",
    });
  });
});

function evidenceRecord(decisionId: string, artifactHash: string, revisionId: string) {
  return {
    decisionId,
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    environment: "production",
    runtimeTarget: { stack: "LOCAL" },
    agentId: "agent-1",
    connector: "github",
    action: "execute",
    status: "ALLOW",
    reason: "allowed",
    policyRefs: [],
    artifactHash,
    policyContext: [{ scope: "WORKSPACE", branchId: "branch-1", revisionId, artifactHash }],
    latencyMs: 1,
    createdAt: "2026-05-07T00:00:00.000Z",
    rawEvidence: {},
  };
}
