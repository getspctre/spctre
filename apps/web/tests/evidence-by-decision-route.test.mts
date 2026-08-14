import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const { state, sqlMock, hasBearerTokenMock, authenticateServiceTokenMock } = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    /** Every WHERE binding the read issued, so tenancy can be asserted. */
    bindings: [] as unknown[][],
  };

  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("").replace(/\s+/g, " ").trim().toUpperCase();
    if (joined.includes("FROM RUNTIME_EVIDENCE_EVENT")) {
      state.bindings.push(args.slice(1));
      return Promise.resolve(state.rows);
    }
    return Promise.resolve([]);
  };

  return { state, sqlMock: fn, hasBearerTokenMock: vi.fn(), authenticateServiceTokenMock: vi.fn() };
});

vi.mock("@/lib/db", () => ({ sql: sqlMock, rawSql: sqlMock }));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, work: () => Promise<unknown>) => work(),
}));

vi.mock("@/lib/service-tokens", () => ({
  hasBearerToken: hasBearerTokenMock,
  authenticateServiceToken: authenticateServiceTokenMock,
}));

vi.mock("@/lib/auth-session", () => ({ getAuthSession: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/workspace", () => ({ getActiveScope: vi.fn().mockResolvedValue(null) }));

import { GET } from "../app/api/evidence/[id]/route";

const TENANT = "00000000-0000-0000-0000-000000000001";
const WORKSPACE = "00000000-0000-0000-0000-000000000002";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/evidence/{id}", () => {
  beforeEach(() => {
    state.rows = [];
    state.bindings = [];
    hasBearerTokenMock.mockReset();
    authenticateServiceTokenMock.mockReset();
    hasBearerTokenMock.mockReturnValue(true);
    authenticateServiceTokenMock.mockResolvedValue({
      ok: true,
      auth: { tenantId: TENANT, workspaceId: WORKSPACE, principalId: "svc-1" },
    });
  });

  it("requires the evidence:read scope", async () => {
    await GET(
      createRouteRequest({ path: "/api/evidence/dec-1", method: "GET", token: "t" }),
      params("dec-1"),
    );

    expect(authenticateServiceTokenMock).toHaveBeenCalledWith(expect.anything(), "evidence:read");
  });

  it("refuses a token that lacks the scope", async () => {
    authenticateServiceTokenMock.mockResolvedValue({
      ok: false,
      error: "Token is missing evidence:read scope.",
    });

    const response = await GET(
      createRouteRequest({ path: "/api/evidence/dec-1", method: "GET", token: "t" }),
      params("dec-1"),
    );

    expect(response.status).toBe(401);
  });

  it("returns the record for a decision id", async () => {
    state.rows = [
      {
        decision_id: "dec-1",
        tenant_id: TENANT,
        workspace_id: WORKSPACE,
        environment: "production",
        status: "ALLOW",
        policy_refs: [],
        created_at: new Date("2026-08-14T00:00:00.000Z"),
      },
    ];

    const response = await GET(
      createRouteRequest({ path: "/api/evidence/dec-1", method: "GET", token: "t" }),
      params("dec-1"),
    );
    const body = (await response.json()) as { evidence?: { decisionId?: string } };

    expect(response.status).toBe(200);
    expect(body.evidence?.decisionId).toBe("dec-1");
  });

  it("binds the read to the caller's tenant and workspace", async () => {
    // The most important property here: the id alone must never be enough.
    state.rows = [];
    await GET(
      createRouteRequest({ path: "/api/evidence/dec-1", method: "GET", token: "t" }),
      params("dec-1"),
    );

    expect(state.bindings[0]).toEqual([TENANT, WORKSPACE, "dec-1"]);
  });

  it("answers 404, not 403, for an id outside the caller's workspace", async () => {
    // A record the query cannot see is reported absent. 403 would confirm the
    // id exists somewhere, which is a disclosure across tenants.
    state.rows = [];

    const response = await GET(
      createRouteRequest({ path: "/api/evidence/someone-elses", method: "GET", token: "t" }),
      params("someone-elses"),
    );

    expect(response.status).toBe(404);
  });

  it("rejects a blank id", async () => {
    const response = await GET(
      createRouteRequest({ path: "/api/evidence/%20", method: "GET", token: "t" }),
      params("   "),
    );

    expect(response.status).toBe(400);
  });
});
