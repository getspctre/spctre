import { beforeEach, describe, expect, it, vi } from "vitest";

// What a token is actually issued with, rather than what a constant says.
//
// The rule here is that a runtime agent can never author, approve or publish
// the policy that governs it. That rule used to be asserted against
// `DEV_TOKEN_SCOPES` directly, which passed while the CLI onboarding exchange
// read a *second*, local copy of the same list — and would have kept passing if
// that copy gained a scope. The constant is single-sourced now, and the mint
// path is driven rather than described, so these fail when the wiring changes
// and not only when the list does.

const getAuthSessionSpy = vi.fn();
const getActiveScopeSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const issueServiceAccountKeySpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));
vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeSpy }));
vi.mock("@/lib/actors", () => ({ findActorById: findActorByIdSpy }));
vi.mock("@/lib/domains/auth/service", () => ({
  listServiceKeys: async () => [],
  recordAuthOperation: async () => {},
  revokeServiceKeyById: vi.fn(),
}));
vi.mock("@/lib/service-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/service-tokens")>();
  return { ...actual, issueServiceAccountKey: issueServiceAccountKeySpy };
});

const { DEV_TOKEN_SCOPES, ADMIN_ISSUABLE_API_KEY_SCOPES } =
  await import("../lib/repositories/auth/service-tokens");
const { POST: mintServiceKey } = await import("../app/api/service-keys/route");

const TENANT = "11111111-1111-4111-8111-111111111111";

/** What a governed runtime must never be able to hold. */
const AUTHORING_SCOPES = [
  "policy:import",
  "blueprint:import",
  "approvals:write",
  "publish:write",
] as const;

function mintRequest(scopes: string[]) {
  return new Request("http://localhost/api/service-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "ci key", scopes }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthSessionSpy.mockResolvedValue({
    sessionId: "session-1",
    tenantId: TENANT,
    principalId: "principal-1",
    subject: "admin@example.com",
    requireMfa: false,
  });
  getActiveScopeSpy.mockResolvedValue({ tenantId: TENANT, workspaceId: "workspace-1" });
  findActorByIdSpy.mockResolvedValue({ id: "principal-1", reviewerRoles: ["Admin"] });
  issueServiceAccountKeySpy.mockResolvedValue({
    id: "key-1",
    token: "spctre_svc_example",
    scopes: [],
  });
});

describe("the token a runtime agent is issued", () => {
  it.each(AUTHORING_SCOPES)("never carries %s", (scope) => {
    expect(DEV_TOKEN_SCOPES).not.toContain(scope);
  });

  it("carries exactly what a runtime needs in order to be governed", () => {
    expect([...DEV_TOKEN_SCOPES].sort()).toEqual([
      "bundle:read",
      "decision:evaluate",
      "evidence:write",
      "heartbeat:write",
    ]);
  });
});

describe("the key an admin mints", () => {
  it("accepts the reviewed-path scopes a person holds and an agent does not", async () => {
    const response = await mintServiceKey(mintRequest(["approvals:write", "publish:write"]));

    expect(response.status).toBe(201);
    expect(issueServiceAccountKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ["approvals:write", "publish:write"] }),
    );
  });

  it("drops a scope that is not admin-issuable rather than minting it", async () => {
    const response = await mintServiceKey(mintRequest(["bundle:read", "e2e:write"]));

    expect(response.status).toBe(201);
    expect(issueServiceAccountKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ["bundle:read"] }),
    );
  });

  it("refuses a request whose every scope was filtered out", async () => {
    const response = await mintServiceKey(mintRequest(["e2e:write", "not-a-scope"]));

    expect(response.status).toBe(400);
    expect(issueServiceAccountKeySpy).not.toHaveBeenCalled();
  });

  it("may issue every authoring scope, because the key acts as its own principal", () => {
    // The deliberate counterpart to the runtime token: a key minted by a person
    // can only ever act with that person's authority, so withholding these from
    // the admin surface would protect nothing.
    for (const scope of AUTHORING_SCOPES) {
      expect(ADMIN_ISSUABLE_API_KEY_SCOPES).toContain(scope);
    }
  });
});
