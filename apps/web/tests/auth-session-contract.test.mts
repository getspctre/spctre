import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues = new Map<string, string>();
const fetchSessionForAuthSpy = vi.fn();
const updateSessionAndPrincipalActivitySpy = vi.fn(async () => undefined);
const verifySessionGuardTokenSpy = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues.get(name);
      return value ? { value } : undefined;
    },
  }),
}));

vi.mock("@/lib/repositories/auth/session", () => ({
  ensureAuthDemoTenant: vi.fn(async () => undefined),
  fetchSessionForAuth: fetchSessionForAuthSpy,
  updateSessionAndPrincipalActivity: updateSessionAndPrincipalActivitySpy,
  createSessionRow: vi.fn(),
  revokeSessionRow: vi.fn(),
  listAllLoginPrincipals: vi.fn(),
}));

vi.mock("@/lib/session-guard", () => ({
  SESSION_GUARD_COOKIE: "spctre_session_guard",
  verifySessionGuardToken: verifySessionGuardTokenSpy,
}));

const { getAuthSession, SESSION_COOKIE } = await import("../lib/auth-session");

const sessionRow = {
  session_id: "session-1",
  tenant_id: "tenant-1",
  principal_id: "principal-1",
  display_name: "Principal One",
  email: "principal@example.test",
  subject: "principal@example.test",
  auth_method: "SESSION",
  require_mfa: true,
  mfa_verified_at: new Date("2026-07-08T00:00:00.000Z"),
};

function setValidCookies() {
  cookieValues.set(SESSION_COOKIE, "session-1");
  cookieValues.set("spctre_session_guard", "guard-token");
}

describe("auth session contract", () => {
  beforeEach(() => {
    cookieValues.clear();
    vi.clearAllMocks();
    fetchSessionForAuthSpy.mockResolvedValue(sessionRow);
    verifySessionGuardTokenSpy.mockResolvedValue({
      sid: "session-1",
      tid: "tenant-1",
      pid: "principal-1",
      sub: "principal@example.test",
      mfa: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
  });

  it("returns null without querying the database when either session cookie is missing", async () => {
    cookieValues.set(SESSION_COOKIE, "session-1");

    await expect(getAuthSession()).resolves.toBeNull();
    expect(fetchSessionForAuthSpy).not.toHaveBeenCalled();
    expect(updateSessionAndPrincipalActivitySpy).not.toHaveBeenCalled();
  });

  it("rejects guard claims that do not match the database session row", async () => {
    setValidCookies();
    verifySessionGuardTokenSpy.mockResolvedValueOnce({
      sid: "session-1",
      tid: "other-tenant",
      pid: "principal-1",
      sub: "principal@example.test",
      mfa: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    await expect(getAuthSession()).resolves.toBeNull();
    expect(fetchSessionForAuthSpy).toHaveBeenCalledWith("session-1");
    expect(verifySessionGuardTokenSpy).toHaveBeenCalledWith("guard-token", "session-1");
    expect(updateSessionAndPrincipalActivitySpy).not.toHaveBeenCalled();
  });

  it("rejects sessions when the guard MFA claim no longer matches persisted MFA state", async () => {
    setValidCookies();
    verifySessionGuardTokenSpy.mockResolvedValueOnce({
      sid: "session-1",
      tid: "tenant-1",
      pid: "principal-1",
      sub: "principal@example.test",
      mfa: false,
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    await expect(getAuthSession()).resolves.toBeNull();
    expect(updateSessionAndPrincipalActivitySpy).not.toHaveBeenCalled();
  });

  it("returns the session and records activity when cookies, guard claims, and database state agree", async () => {
    setValidCookies();

    const session = await getAuthSession();

    expect(session).toEqual({
      sessionId: "session-1",
      tenantId: "tenant-1",
      principalId: "principal-1",
      displayName: "Principal One",
      email: "principal@example.test",
      subject: "principal@example.test",
      authMethod: "SESSION",
      requireMfa: true,
      mfaVerified: true,
    });
    expect(updateSessionAndPrincipalActivitySpy).toHaveBeenCalledWith(
      "session-1",
      "principal-1",
      "tenant-1",
    );
  });
});
