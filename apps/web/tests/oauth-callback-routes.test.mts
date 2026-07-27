import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAuthSessionSpy,
  fetchWithTimeoutSpy,
  getAuthSessionSpy,
  getPrimaryWorkspaceIdForTenantSpy,
  getTenantRequireMfaSpy,
  isAuthDatabaseConfiguredSpy,
  linkSocialIdentitySpy,
  setControlPlaneSessionCookiesSpy,
  upsertSocialPrincipalSpy,
} = vi.hoisted(() => ({
  createAuthSessionSpy: vi.fn(async () => "session-1"),
  fetchWithTimeoutSpy: vi.fn(),
  getAuthSessionSpy: vi.fn(async () => null),
  getPrimaryWorkspaceIdForTenantSpy: vi.fn(async () => "workspace-primary"),
  getTenantRequireMfaSpy: vi.fn(async () => false),
  isAuthDatabaseConfiguredSpy: vi.fn(() => true),
  linkSocialIdentitySpy: vi.fn(async () => undefined),
  setControlPlaneSessionCookiesSpy: vi.fn(async () => undefined),
  upsertSocialPrincipalSpy: vi.fn(async () => ({
    principalId: "principal-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  })),
}));

vi.mock("@/lib/auth-session", () => ({
  createAuthSession: createAuthSessionSpy,
  getAuthSession: getAuthSessionSpy,
}));

vi.mock("@/lib/auth-session-cookies", () => ({
  setControlPlaneSessionCookies: setControlPlaneSessionCookiesSpy,
}));

vi.mock("@/lib/domains/auth/service", () => ({
  getPrimaryWorkspaceIdForTenant: getPrimaryWorkspaceIdForTenantSpy,
  getTenantRequireMfa: getTenantRequireMfaSpy,
  isAuthDatabaseConfigured: isAuthDatabaseConfiguredSpy,
  linkSocialIdentity: linkSocialIdentitySpy,
  upsertSocialPrincipal: upsertSocialPrincipalSpy,
}));

vi.mock("@/lib/platform/fetch-timeout", () => ({
  fetchWithTimeout: fetchWithTimeoutSpy,
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: vi.fn(async () => ({
    payload: {
      sub: "google-subject",
      email: "google@example.com",
      name: "Google User",
      email_verified: true,
    },
  })),
}));

const { GET: githubCallback } = await import("../app/api/auth/github/callback/route");
const { GET: googleCallback } = await import("../app/api/auth/google/callback/route");

describe("OAuth callback routes", () => {
  beforeEach(() => {
    createAuthSessionSpy.mockClear();
    fetchWithTimeoutSpy.mockReset();
    getAuthSessionSpy.mockReset();
    getPrimaryWorkspaceIdForTenantSpy.mockClear();
    getTenantRequireMfaSpy.mockReset();
    isAuthDatabaseConfiguredSpy.mockReset();
    linkSocialIdentitySpy.mockClear();
    setControlPlaneSessionCookiesSpy.mockClear();
    upsertSocialPrincipalSpy.mockReset();

    getAuthSessionSpy.mockResolvedValue(null);
    getTenantRequireMfaSpy.mockResolvedValue(false);
    isAuthDatabaseConfiguredSpy.mockReturnValue(true);
    upsertSocialPrincipalSpy.mockResolvedValue({
      principalId: "principal-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    });

    process.env.GITHUB_CLIENT_ID = "github-client";
    process.env.GITHUB_CLIENT_SECRET = "github-secret";
    process.env.GOOGLE_CLIENT_ID = "google-client";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  it("rejects a GitHub callback with a mismatched state cookie", async () => {
    const request = new Request("http://localhost:3000/api/auth/github/callback?code=abc&state=state-1:%2Faccount", {
      headers: { cookie: "spctre_github_state=state-2" },
    });

    const response = await githubCallback(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=invalid_state");
    expect(fetchWithTimeoutSpy).not.toHaveBeenCalled();
  });

  it("rejects a Google callback with a mismatched state cookie", async () => {
    const request = new Request("http://localhost:3000/api/auth/google/callback?code=abc&state=state-1:%2Faccount", {
      headers: { cookie: "spctre_google_state=state-2" },
    });

    const response = await googleCallback(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=invalid_state");
    expect(fetchWithTimeoutSpy).not.toHaveBeenCalled();
  });

  it("redirects when GitHub token exchange fails before session finalization", async () => {
    fetchWithTimeoutSpy.mockResolvedValue({ ok: false });
    const request = new Request("http://localhost:3000/api/auth/github/callback?code=abc&state=state-1:%2Faccount", {
      headers: { cookie: "spctre_github_state=state-1" },
    });

    const response = await githubCallback(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=token_exchange_failed");
    expect(upsertSocialPrincipalSpy).not.toHaveBeenCalled();
    expect(createAuthSessionSpy).not.toHaveBeenCalled();
  });
});
