import { describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const authenticateServiceTokenSpy = vi.fn();

vi.mock("@/lib/repositories/publication-attestations", () => ({
  listPublicationAttestations: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: vi.fn(async (_tenantId: string, operation: () => unknown) => operation()),
}));

vi.mock("@/lib/repositories/gateway", () => ({
  getGatewayOutcomesForDecisions: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/domains/evidence/service", () => ({
  getGatewayOutcomeMapForEvidence: vi.fn().mockResolvedValue(new Map()),
  listEvidenceForExport: vi.fn().mockResolvedValue([]),
  listEvidenceForTokenExport: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: authenticateServiceTokenSpy,
  hasBearerToken: (request: Request) =>
    (request.headers.get("authorization") ?? "").startsWith("Bearer "),
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
      evidenceExportGrants: [{ revisionId: "revision-1", notBefore: "2026-01-01T00:00:00.000Z" }],
    },
  };

  it("rejects a caller-supplied connector that disagrees with token identity", async () => {
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    const response = await route.GET(
      createRouteRequest({
        path: "/api/evidence/export?connector=acquisition-author",
        method: "GET",
        token: "token",
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
      createRouteRequest({ path: "/api/evidence/export", method: "GET", token: "token" }),
    );
    expect(response.status).toBe(401);
  });

  it("does not mint an AGT verification packet from an evidence export", async () => {
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    const response = await route.GET(
      createRouteRequest({
        path: "/api/evidence/export?format=agt-verification",
        method: "GET",
        token: "token",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("exports only server-derived connector and revision grants for a bearer", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({
      ok: true,
      auth: {
        ...evidenceExportAuth.auth,
        evidenceExportGrants: [
          ...evidenceExportAuth.auth.evidenceExportGrants,
          {
            revisionId: "revision-2",
            notBefore: "2026-02-01T00:00:00.000Z",
            notAfter: "2026-03-01T00:00:00.000Z",
          },
        ],
      },
    });
    const response = await route.GET(
      createRouteRequest({
        path: "/api/evidence/export?format=json",
        method: "GET",
        token: "token",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorization: {
        connector: "acquisition-scout",
        revisionGrants: [
          { revisionId: "revision-1", notBefore: "2026-01-01T00:00:00.000Z" },
          {
            revisionId: "revision-2",
            notBefore: "2026-02-01T00:00:00.000Z",
            notAfter: "2026-03-01T00:00:00.000Z",
          },
        ],
      },
    });
  });

  it("does not mint an AGT verification packet for a session either", async () => {
    const response = await route.GET(
      createRouteRequest({ path: "/api/evidence/export?format=agt-verification", method: "GET" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("live compatibility harness"),
    });
  });
});
