import { describe, expect, it, vi } from "vitest";

const authenticateServiceTokenSpy = vi.fn();

vi.mock("@/lib/repositories/gateway", () => ({
  getGatewayOutcomesForDecisions: vi.fn().mockResolvedValue(new Map()),
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
      new Request("http://localhost:3000/api/evidence/export", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("does not mint an AGT verification packet from an evidence export", async () => {
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    const response = await route.GET(
      new Request("http://localhost:3000/api/evidence/export?format=agt-verification", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("does not mint an AGT verification packet for a session either", async () => {
    const response = await route.GET(
      new Request("http://localhost:3000/api/evidence/export?format=agt-verification"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("live compatibility harness"),
    });
  });
});
