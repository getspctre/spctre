/**
 * GDPR Art. 17 evidence erasure — route contract for /api/evidence/erase.
 * Erasure tombstones PII-bearing evidence content in place and must always be
 * an explicit, bounded action (at least one filter required).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const authenticateServiceTokenMock = vi.fn();

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: authenticateServiceTokenMock,
  hasBearerToken: () => true,
}));

const eraseEvidencePiiMock = vi.fn();

vi.mock("@/lib/domains/compliance/service", () => ({ eraseEvidencePii: eraseEvidencePiiMock }));

const { POST: erasePost } = await import("../app/api/evidence/erase/route");

function eraseRequest(body: unknown): Request {
  return createRouteRequest({ path: "/api/evidence/erase", token: "svc-token", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateServiceTokenMock.mockResolvedValue({
    ok: true,
    auth: {
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      principalId: "svc-test",
      scopes: ["evidence:write"],
    },
  });
});

describe("POST /api/evidence/erase", () => {
  it("returns 401 when the service token is invalid", async () => {
    authenticateServiceTokenMock.mockResolvedValue({ ok: false, error: "Missing bearer token." });

    const res = await erasePost(eraseRequest({ agentId: "agent-1" }));
    expect(res.status).toBe(401);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no filter is provided", async () => {
    const res = await erasePost(eraseRequest({}));
    expect(res.status).toBe(400);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    // Raw malformed JSON is the behavior under test, so this bypasses the helper.
    const req = new Request("http://localhost:3000/api/evidence/erase", {
      method: "POST",
      headers: { Authorization: "Bearer svc-token" },
    });
    const res = await erasePost(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when 'before' is not a valid timestamp", async () => {
    const res = await erasePost(eraseRequest({ before: "not-a-date" }));
    expect(res.status).toBe(400);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("returns 400 when an invalid 'before' accompanies a valid filter (no silent scope widening)", async () => {
    // A malformed `before` must fail the request, not be dropped — dropping it
    // would erase ALL of the agent's evidence instead of the pre-date subset.
    const res = await erasePost(eraseRequest({ agentId: "agent-7", before: "2026-13-45" }));
    expect(res.status).toBe(400);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("returns 400 when decisionIds is present but not a valid string array", async () => {
    const res = await erasePost(eraseRequest({ agentId: "agent-7", decisionIds: [123, ""] }));
    expect(res.status).toBe(400);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("returns 400 when agentId is present but empty", async () => {
    const res = await erasePost(eraseRequest({ agentId: "   ", decisionIds: ["d-1"] }));
    expect(res.status).toBe(400);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-ISO 'before' even when Date could parse it (no locale reinterpretation)", async () => {
    // "03/02/2026" is dd/mm in most locales but Date.parse reads it as mm/dd —
    // accepting it would silently shift an irreversible erasure bound.
    const res = await erasePost(eraseRequest({ agentId: "agent-7", before: "03/02/2026" }));
    expect(res.status).toBe(400);
    expect(eraseEvidencePiiMock).not.toHaveBeenCalled();
  });

  it("treats an empty decisionIds array as an absent filter, not a malformed one", async () => {
    eraseEvidencePiiMock.mockResolvedValue({ erasedCount: 0, erasedDecisionIds: [] });

    const res = await erasePost(eraseRequest({ agentId: "agent-7", decisionIds: [] }));
    expect(res.status).toBe(200);
    expect(eraseEvidencePiiMock).toHaveBeenCalledWith(
      "demo-ws",
      "demo-tenant",
      { decisionIds: undefined, agentId: "agent-7", before: undefined },
      "svc-test",
    );
  });

  it("erases by decision ids and returns the erased set", async () => {
    eraseEvidencePiiMock.mockResolvedValue({ erasedCount: 2, erasedDecisionIds: ["d-1", "d-2"] });

    const res = await erasePost(eraseRequest({ decisionIds: ["d-1", "d-2"] }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.erasedCount).toBe(2);
    expect(body.erasedDecisionIds).toEqual(["d-1", "d-2"]);

    expect(eraseEvidencePiiMock).toHaveBeenCalledWith(
      "demo-ws",
      "demo-tenant",
      { decisionIds: ["d-1", "d-2"], agentId: undefined, before: undefined },
      "svc-test",
    );
  });

  it("normalizes 'before' to an ISO timestamp and passes agentId through", async () => {
    eraseEvidencePiiMock.mockResolvedValue({ erasedCount: 0, erasedDecisionIds: [] });

    const res = await erasePost(
      eraseRequest({ agentId: "agent-7", before: "2026-06-01T00:00:00+02:00" }),
    );
    expect(res.status).toBe(200);

    expect(eraseEvidencePiiMock).toHaveBeenCalledWith(
      "demo-ws",
      "demo-tenant",
      { decisionIds: undefined, agentId: "agent-7", before: "2026-05-31T22:00:00.000Z" },
      "svc-test",
    );
  });

  it("returns 500 when the erasure operation throws", async () => {
    eraseEvidencePiiMock.mockRejectedValue(new Error("DB error"));

    const res = await erasePost(eraseRequest({ agentId: "agent-1" }));
    expect(res.status).toBe(500);
  });
});
