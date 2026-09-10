import { beforeEach, describe, expect, it, vi } from "vitest";

// The service-key API routes had no demo guard while the server action behind
// the same form did, so a demo tenant could mint (and revoke) a real key by
// calling the API the UI refused. These tests pin both halves of that contract.

const getAuthSessionSpy = vi.fn();
const getActiveScopeSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const issueServiceAccountKeySpy = vi.fn();
const revokeServiceKeyByIdSpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));
vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeSpy }));
vi.mock("@/lib/actors", () => ({ findActorById: findActorByIdSpy }));

vi.mock("@/lib/domains/auth/service", () => ({
  listServiceKeys: async () => [],
  recordAuthOperation: async () => {},
  revokeServiceKeyById: revokeServiceKeyByIdSpy,
}));

vi.mock("@/lib/service-tokens", () => ({
  ADMIN_ISSUABLE_API_KEY_SCOPES: ["bundle:read", "evidence:write"],
  issueServiceAccountKey: issueServiceAccountKeySpy,
}));

const { POST } = await import("../app/api/service-keys/route");
const { DELETE } = await import("../app/api/service-keys/[id]/route");

const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const REGULAR_TENANT = "11111111-1111-4111-8111-111111111111";
const FRIENDLY_ERROR =
  "This action is read-only in Demo Mode. Create a free Spctre Cloud account to save changes!";

function createRequest() {
  return new Request("http://localhost/api/service-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "e2e key", scopes: ["bundle:read"] }),
  });
}

function deleteRequest() {
  return new Request("http://localhost/api/service-keys/key-1", { method: "DELETE" });
}

const params = Promise.resolve({ id: "key-1" });

function signInAs(tenantId: string) {
  getAuthSessionSpy.mockResolvedValue({
    sessionId: "session-123",
    tenantId,
    principalId: "p-123",
    subject: "user@example.com",
    requireMfa: false,
  });
  getActiveScopeSpy.mockResolvedValue({ tenantId, workspaceId: "w-123" });
}

describe("service-key API routes — demo tenant write guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findActorByIdSpy.mockResolvedValue({ id: "p-123", reviewerRoles: ["Admin"] });
    issueServiceAccountKeySpy.mockResolvedValue({
      tokenId: "token-id",
      rawToken: "spctre_svc_raw",
      tokenPrefix: "spctre_svc_abc",
      scopes: ["bundle:read"],
      expiresAt: null,
    });
    revokeServiceKeyByIdSpy.mockResolvedValue(true);
  });

  it("refuses POST for the demo tenant without issuing a key", async () => {
    signInAs(DEMO_TENANT);

    const res = await POST(createRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: FRIENDLY_ERROR });
    // The refusal must happen before the key exists, not after.
    expect(issueServiceAccountKeySpy).not.toHaveBeenCalled();
  });

  it("refuses DELETE for the demo tenant without revoking", async () => {
    signInAs(DEMO_TENANT);

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: FRIENDLY_ERROR });
    expect(revokeServiceKeyByIdSpy).not.toHaveBeenCalled();
  });

  it("still issues a key for a regular tenant", async () => {
    signInAs(REGULAR_TENANT);

    const res = await POST(createRequest());

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ rawToken: "spctre_svc_raw" });
    expect(issueServiceAccountKeySpy).toHaveBeenCalledOnce();
  });

  it("still revokes for a regular tenant", async () => {
    signInAs(REGULAR_TENANT);

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(204);
    expect(revokeServiceKeyByIdSpy).toHaveBeenCalledOnce();
  });

  it("answers the admin check before the demo check", async () => {
    signInAs(DEMO_TENANT);
    findActorByIdSpy.mockResolvedValue({ id: "p-123", reviewerRoles: ["Security"] });

    const res = await POST(createRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Admin permission is required." });
  });
});
