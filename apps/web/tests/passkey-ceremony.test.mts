import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSKEY_LOGIN_CHALLENGE_COOKIE,
  PASSKEY_REG_CHALLENGE_COOKIE,
} from "../lib/auth-challenge";

// The pre-fix login "finish" minted a session after only matching a challenge
// cookie and an enrolled credential ID — it never verified an assertion. These
// tests lock in that the route now depends on a real verification result and
// never trusts client-supplied identity or keys.

const {
  consumeWebauthnChallengeSpy,
  getPasskeyByCredentialIdSpy,
  getPrincipalSubjectSpy,
  getPrimaryWorkspaceIdForTenantSpy,
  recordPasskeyAuthenticationSpy,
  upsertPasskeyCredentialSpy,
  createAuthSessionSpy,
  setControlPlaneSessionCookiesSpy,
  getAuthSessionSpy,
  verifyAuthenticationResponseSpy,
  verifyRegistrationResponseSpy,
} = vi.hoisted(() => ({
  consumeWebauthnChallengeSpy: vi.fn(),
  getPasskeyByCredentialIdSpy: vi.fn(),
  getPrincipalSubjectSpy: vi.fn(async () => "subject-1"),
  getPrimaryWorkspaceIdForTenantSpy: vi.fn(async () => "workspace-1"),
  recordPasskeyAuthenticationSpy: vi.fn(async () => "ok"),
  upsertPasskeyCredentialSpy: vi.fn(async () => "ok"),
  createAuthSessionSpy: vi.fn(async () => "session-1"),
  setControlPlaneSessionCookiesSpy: vi.fn(async () => undefined),
  getAuthSessionSpy: vi.fn(),
  verifyAuthenticationResponseSpy: vi.fn(),
  verifyRegistrationResponseSpy: vi.fn(),
}));

let loginChallengeCookie: string | undefined;
let regChallengeCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === PASSKEY_LOGIN_CHALLENGE_COOKIE && loginChallengeCookie) {
        return { value: loginChallengeCookie };
      }
      if (name === PASSKEY_REG_CHALLENGE_COOKIE && regChallengeCookie) {
        return { value: regChallengeCookie };
      }
      return undefined;
    },
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  createAuthSession: createAuthSessionSpy,
  getAuthSession: getAuthSessionSpy,
}));

vi.mock("@/lib/auth-session-cookies", () => ({
  setControlPlaneSessionCookies: setControlPlaneSessionCookiesSpy,
}));

vi.mock("@/lib/domains/auth/service", () => ({
  isAuthDatabaseConfigured: () => true,
  consumeWebauthnChallenge: consumeWebauthnChallengeSpy,
  getPasskeyByCredentialId: getPasskeyByCredentialIdSpy,
  getPrincipalSubject: getPrincipalSubjectSpy,
  getPrimaryWorkspaceIdForTenant: getPrimaryWorkspaceIdForTenantSpy,
  recordPasskeyAuthentication: recordPasskeyAuthenticationSpy,
  upsertPasskeyCredential: upsertPasskeyCredentialSpy,
}));

vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: verifyAuthenticationResponseSpy,
  verifyRegistrationResponse: verifyRegistrationResponseSpy,
}));

const loginFinish = await import("../app/api/auth/passkey/login/finish/route");
const registerFinish = await import("../app/api/auth/passkey/register/finish/route");

function loginRequest(body: unknown) {
  return new Request("http://localhost:3000/api/auth/passkey/login/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function registerRequest(body: unknown) {
  return new Request("http://localhost:3000/api/auth/passkey/register/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const storedCredential = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  credentialIdB64: "cred-abc",
  publicKeyB64: "cHVibGljLWtleQ", // base64url("public-key")
  counter: 3,
  transports: ["internal"],
};

describe("passkey login finish (assertion verification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginChallengeCookie = "challenge-row-1";
    getPasskeyByCredentialIdSpy.mockResolvedValue(storedCredential);
    consumeWebauthnChallengeSpy.mockResolvedValue({
      challenge: "expected-challenge",
      principalId: null,
      tenantId: null,
    });
    getPrincipalSubjectSpy.mockResolvedValue("subject-1");
    recordPasskeyAuthenticationSpy.mockResolvedValue("ok");
  });

  it("rejects when there is no challenge cookie and never creates a session", async () => {
    loginChallengeCookie = undefined;
    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-abc" } }));
    expect(res.status).toBe(400);
    expect(consumeWebauthnChallengeSpy).not.toHaveBeenCalled();
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown credential without verifying or minting a session", async () => {
    getPasskeyByCredentialIdSpy.mockResolvedValue(null);
    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-unknown" } }));
    expect(res.status).toBe(403);
    expect(verifyAuthenticationResponseSpy).not.toHaveBeenCalled();
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
  });

  it("rejects when the assertion fails verification", async () => {
    verifyAuthenticationResponseSpy.mockResolvedValue({ verified: false });
    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-abc" } }));
    expect(res.status).toBe(403);
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
    expect(recordPasskeyAuthenticationSpy).not.toHaveBeenCalled();
  });

  it("rejects when verification throws (e.g. counter regression, bad signature)", async () => {
    verifyAuthenticationResponseSpy.mockRejectedValue(new Error("counter regressed"));
    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-abc" } }));
    expect(res.status).toBe(403);
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
  });

  it("verifies against the stored challenge/key, then derives identity from the record", async () => {
    verifyAuthenticationResponseSpy.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 9, credentialID: "cred-abc" },
    });

    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-abc" } }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });

    // Verified against the server-held challenge, not anything from the client.
    const verifyArgs = verifyAuthenticationResponseSpy.mock.calls[0][0];
    expect(verifyArgs.expectedChallenge).toBe("expected-challenge");
    expect(verifyArgs.credential.id).toBe("cred-abc");
    expect(verifyArgs.credential.counter).toBe(3);

    // New counter persisted via compare-and-swap against the verified value.
    expect(recordPasskeyAuthenticationSpy).toHaveBeenCalledWith({
      credentialId: "cred-abc",
      expectedCounter: 3,
      newCounter: 9,
    });

    // Tenant/principal came from the stored credential, never the client.
    expect(createAuthSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", principalId: "principal-1" }),
    );
    expect(setControlPlaneSessionCookiesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", principalId: "principal-1" }),
    );
  });

  it("cannot replay a consumed challenge", async () => {
    consumeWebauthnChallengeSpy.mockResolvedValue(null);
    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-abc" } }));
    expect(res.status).toBe(400);
    expect(verifyAuthenticationResponseSpy).not.toHaveBeenCalled();
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the counter advanced concurrently (CAS lost)", async () => {
    verifyAuthenticationResponseSpy.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 9, credentialID: "cred-abc" },
    });
    // Another concurrent assertion already advanced the stored counter.
    recordPasskeyAuthenticationSpy.mockResolvedValue("counter-conflict");

    const res = await loginFinish.POST(loginRequest({ response: { id: "cred-abc" } }));
    expect(res.status).toBe(403);
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
    expect(setControlPlaneSessionCookiesSpy).not.toHaveBeenCalled();
  });
});

describe("passkey register finish (attestation verification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    regChallengeCookie = "reg-row-1";
    getAuthSessionSpy.mockResolvedValue({
      tenantId: "tenant-1",
      principalId: "principal-1",
      subject: "subject-1",
    });
    consumeWebauthnChallengeSpy.mockResolvedValue({
      challenge: "expected-reg-challenge",
      principalId: "principal-1",
      tenantId: "tenant-1",
    });
    upsertPasskeyCredentialSpy.mockResolvedValue("ok");
  });

  it("rejects a challenge issued to a different principal/tenant", async () => {
    consumeWebauthnChallengeSpy.mockResolvedValue({
      challenge: "expected-reg-challenge",
      principalId: "someone-else",
      tenantId: "tenant-1",
    });
    const res = await registerFinish.POST(registerRequest({ response: { id: "cred-new" } }));
    expect(res.status).toBe(400);
    expect(upsertPasskeyCredentialSpy).not.toHaveBeenCalled();
  });

  it("stores only the verified authenticator public key, never a client-supplied one", async () => {
    verifyRegistrationResponseSpy.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "verified-cred-id",
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ["internal", "hybrid"],
        },
      },
    });

    // The client body carries no public key — the server derives it from attestation.
    const res = await registerFinish.POST(
      registerRequest({ response: { id: "verified-cred-id", publicKey: "attacker-supplied" } }),
    );
    expect(res.status).toBe(201);

    expect(upsertPasskeyCredentialSpy).toHaveBeenCalledTimes(1);
    const stored = upsertPasskeyCredentialSpy.mock.calls[0][0];
    expect(stored.credentialId).toBe("verified-cred-id");
    expect(stored.counter).toBe(0);
    expect(stored.transports).toEqual(["internal", "hybrid"]);
    // Public key is the base64url of the verified COSE bytes, not the client string.
    expect(stored.publicKey).not.toBe("attacker-supplied");
    expect(typeof stored.publicKey).toBe("string");
  });

  it("rejects when attestation verification fails", async () => {
    verifyRegistrationResponseSpy.mockResolvedValue({ verified: false });
    const res = await registerFinish.POST(registerRequest({ response: { id: "cred-new" } }));
    expect(res.status).toBe(400);
    expect(upsertPasskeyCredentialSpy).not.toHaveBeenCalled();
  });

  it("refuses to reassign a credential already bound to another account", async () => {
    verifyRegistrationResponseSpy.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "someone-elses-cred",
          publicKey: new Uint8Array([9]),
          counter: 0,
          transports: [],
        },
      },
    });
    // The store reports the credential belongs to a different principal.
    upsertPasskeyCredentialSpy.mockResolvedValue("conflict");

    const res = await registerFinish.POST(
      registerRequest({ response: { id: "someone-elses-cred" } }),
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "This passkey is already registered to another account.",
    });
  });
});
