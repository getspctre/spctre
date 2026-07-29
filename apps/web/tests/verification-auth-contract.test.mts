import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the /api/verification auth contract. POST has always
// mapped *every* auth failure (including "Workspace context unavailable.") to
// 401 and tagged the error metric with 401; GET returns 400 for a missing
// workspace context. Adopting the shared resolveRouteScope helper must not
// change either. See apps/web/app/api/_route-scope.ts (contextUnavailableStatus).

const {
  getActiveScopeSpy,
  getAuthSessionSpy,
  incrementCounterSpy,
  recordDurationSpy,
} = vi.hoisted(() => ({
  getActiveScopeSpy: vi.fn(),
  getAuthSessionSpy: vi.fn(),
  incrementCounterSpy: vi.fn(),
  recordDurationSpy: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: getAuthSessionSpy,
}));

vi.mock("@/lib/workspace", () => ({
  getActiveScope: getActiveScopeSpy,
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi.fn(),
  hasBearerToken: () => false,
}));

vi.mock("@spctre/platform/metrics", () => ({
  incrementCounter: incrementCounterSpy,
  recordDuration: recordDurationSpy,
}));

vi.mock("@spctre/platform/tracing", () => ({
  withSpan: (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttributes: vi.fn() }),
}));

vi.mock("@/lib/domains/verification/service", () => ({
  ingestVerification: vi.fn(),
  listVerificationRuns: vi.fn(),
  recordVerificationOperation: vi.fn(),
}));

const { POST: verificationPost, GET: verificationGet } = await import("../app/api/verification/route");

function session() {
  return { principalId: "principal-1", tenantId: "tenant-1" };
}

describe("/api/verification auth contract", () => {
  beforeEach(() => {
    getActiveScopeSpy.mockReset();
    getAuthSessionSpy.mockReset();
    incrementCounterSpy.mockReset();
    recordDurationSpy.mockReset();
  });

  it("POST returns 401 (not 400) when a valid session has no active workspace", async () => {
    getAuthSessionSpy.mockResolvedValueOnce(session());
    getActiveScopeSpy.mockResolvedValueOnce(null);

    const response = await verificationPost(
      new Request("http://localhost:3000/api/verification", { method: "POST" })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Workspace context unavailable." });

    // The emitted error metric must stay labelled 401 for this case.
    expect(incrementCounterSpy).toHaveBeenCalledWith(
      "spctre.api.errors",
      1,
      expect.objectContaining({ "http.route": "/api/verification", "http.response.status_code": 401 })
    );
  });

  it("GET keeps returning 400 when a valid session has no active workspace", async () => {
    getAuthSessionSpy.mockResolvedValueOnce(session());
    getActiveScopeSpy.mockResolvedValueOnce(null);

    const response = await verificationGet(new Request("http://localhost:3000/api/verification"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Workspace context unavailable." });
  });
});
