import { describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const authenticateServiceTokenSpy = vi.fn();
const listPublicationAttestationsSpy = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/repositories/publication-attestations", () => ({
  listPublicationAttestations: listPublicationAttestationsSpy,
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

function publicationRecord(id: string) {
  return {
    id,
    contentHash: "sha256:content",
    contentIdentity: "article-1",
    contentVersion: "v1",
    supersedesId: null,
    payloadHash: "sha256:payload",
    policyContext: {},
    receiptVerified: true,
    attestedAt: "2026-08-13T18:00:00.000Z",
    createdAt: "2026-08-13T18:00:00.000Z",
    payload: {},
  };
}

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
      complete: true,
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
    expect(listPublicationAttestationsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        tenantId: "tenant-1",
        exportGrants: evidenceExportAuth.auth.evidenceExportGrants.concat({
          revisionId: "revision-2",
          notBefore: "2026-02-01T00:00:00.000Z",
          notAfter: "2026-03-01T00:00:00.000Z",
        }),
      }),
    );
  });

  it("streams publication pages instead of retaining the complete ledger", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      publicationRecord(`page-1-${index}`),
    );
    listPublicationAttestationsSpy.mockClear();
    listPublicationAttestationsSpy
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([publicationRecord("page-2-0")]);
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);

    const response = await route.GET(
      createRouteRequest({
        path: "/api/evidence/export?format=json",
        method: "GET",
        token: "token",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      complete: true,
      publicationAttestations: expect.arrayContaining([
        expect.objectContaining({ id: "page-1-0" }),
        expect.objectContaining({ id: "page-2-0" }),
      ]),
    });
    expect(listPublicationAttestationsSpy).toHaveBeenCalledTimes(2);
    expect(listPublicationAttestationsSpy.mock.calls[1]?.[0]).toMatchObject({
      before: { attestedAt: "2026-08-13T18:00:00.000Z", id: "page-1-499" },
    });
  });

  it("serializes an exact full publication page without a trailing separator", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      publicationRecord(`page-1-${index}`),
    );
    listPublicationAttestationsSpy.mockClear();
    listPublicationAttestationsSpy.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]);
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);

    const response = await route.GET(
      createRouteRequest({
        path: "/api/evidence/export?format=json",
        method: "GET",
        token: "token",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      complete: true,
      publicationAttestations: expect.arrayContaining([
        expect.objectContaining({ id: "page-1-499" }),
      ]),
    });
    expect(listPublicationAttestationsSpy).toHaveBeenCalledTimes(2);
  });

  it("does not query publication attestations for CSV", async () => {
    listPublicationAttestationsSpy.mockClear();
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);

    const response = await route.GET(
      createRouteRequest({ path: "/api/evidence/export", method: "GET", token: "token" }),
    );

    expect(response.status).toBe(200);
    expect(listPublicationAttestationsSpy).not.toHaveBeenCalled();
  });

  it("fails the body instead of claiming a completed export when a later page fails", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      publicationRecord(`page-1-${index}`),
    );
    listPublicationAttestationsSpy.mockClear();
    listPublicationAttestationsSpy
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error("database unavailable"));
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);

    const response = await route.GET(
      createRouteRequest({
        path: "/api/evidence/export?format=json",
        method: "GET",
        token: "token",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow("database unavailable");
    expect(listPublicationAttestationsSpy).toHaveBeenCalledTimes(2);
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
