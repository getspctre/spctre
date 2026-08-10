import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectSpy = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectSpy(url);
    throw new Error(`Redirected to: ${url}`); // Next.js redirect throws an error to halt execution
  },
}));

vi.mock("@/lib/repositories/shared/database", () => ({ isDatabaseConfigured: () => true }));

const ensureAuthDemoTenantSpy = vi.fn();
const upsertLocalDevPrincipalSpy = vi.fn();
const upsertLocalDevWorkspaceGrantSpy = vi.fn();
const getPrincipalForLoginSpy = vi.fn();
const createAuthSessionSpy = vi.fn(async () => "session-123");
const cookieSetSpy = vi.fn();
const ensureLocalDevTenantWorkspaceSpy = vi.fn();
const ensureDefaultPublishedPolicyPackSpy = vi.fn();

vi.mock("@/lib/repositories/auth/session", () => ({
  ensureAuthDemoTenant: ensureAuthDemoTenantSpy,
  getPrincipalForLogin: getPrincipalForLoginSpy,
  getPrimaryWorkspaceIdForTenant: async () => "demo-workspace",
}));

vi.mock("@/lib/repositories/auth/principal", () => ({
  ensureLocalDevTenantWorkspace: ensureLocalDevTenantWorkspaceSpy,
  upsertLocalDevPrincipal: upsertLocalDevPrincipalSpy,
}));

vi.mock("@/lib/repositories/auth/grants", () => ({
  upsertLocalDevWorkspaceGrant: upsertLocalDevWorkspaceGrantSpy,
}));

vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: ensureDefaultPublishedPolicyPackSpy,
}));

vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "demo-tenant",
  DEMO_WORKSPACE_ID: "demo-workspace",
  DEMO_PRINCIPAL_IDS: { owner: "00000000-0000-0000-0000-000000000013" },
}));

vi.mock("@/lib/domains/auth/service", () => ({
  bootstrapDemoTenant: ensureAuthDemoTenantSpy,
  authenticatePrincipalForLogin: getPrincipalForLoginSpy,
  getPrimaryWorkspaceId: async () => "demo-workspace",
  verifyMfaLoginCode: async (params: any) => {
    if (params.code === "123456") return { ok: true };
    return { error: "Invalid MFA code." };
  },
  createLocalDevSignup: vi.fn().mockImplementation(async (params: any) => {
    const localWorkspace = await ensureLocalDevTenantWorkspaceSpy({
      email: params.email,
      displayName: params.displayName,
    });
    const tenantId = localWorkspace?.tenantId || "local-tenant";
    const workspaceId = localWorkspace?.workspaceId || "local-workspace";
    const principalId = await upsertLocalDevPrincipalSpy({
      tenantId,
      email: params.email,
      displayName: params.displayName,
    });
    await upsertLocalDevWorkspaceGrantSpy({ tenantId, principalId, workspaceId });
    await ensureDefaultPublishedPolicyPackSpy({ tenantId, workspaceId, actorId: principalId });
    return { ok: true };
  }),
}));

vi.mock("@/lib/auth-session", () => ({
  SESSION_COOKIE: "spctre_session_id",
  createAuthSession: createAuthSessionSpy,
  sessionTtlHours: () => 24,
  revokeAuthSession: async () => {},
  getAuthSession: async () => ({
    sessionId: "session-123",
    tenantId: "demo-tenant",
    principalId: "p-123",
    subject: "user@example.com",
    requireMfa: false,
  }),
}));

vi.mock("@/lib/session-guard", () => ({
  SESSION_GUARD_COOKIE: "spctre_session_guard",
  createSessionGuardToken: async () => "guard-token-123",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSetSpy }),
  headers: async () => ({ get: () => "mock-user-agent" }),
}));

const { localDevSignup } = await import("../app/signup/actions");
const { launchDemoCloud, loginWithPrincipal } = await import("../app/auth-actions");

describe("Auth and signup redirection targets", () => {
  beforeEach(() => {
    redirectSpy.mockReset();
    ensureAuthDemoTenantSpy.mockReset();
    ensureAuthDemoTenantSpy.mockResolvedValue({ ok: true });
    upsertLocalDevPrincipalSpy.mockReset();
    upsertLocalDevWorkspaceGrantSpy.mockReset();
    getPrincipalForLoginSpy.mockReset();
    createAuthSessionSpy.mockClear();
    cookieSetSpy.mockClear();
    ensureLocalDevTenantWorkspaceSpy.mockReset();
    ensureDefaultPublishedPolicyPackSpy.mockReset();
    ensureLocalDevTenantWorkspaceSpy.mockResolvedValue({
      tenantId: "local-tenant",
      workspaceId: "local-workspace",
    });
    process.env.LOCAL_SIGNUP_ENABLED = "true";
  });

  describe("localDevSignup", () => {
    it("redirects back to login with next parameter preserved on successful signup", async () => {
      upsertLocalDevPrincipalSpy.mockResolvedValue("p-123");
      upsertLocalDevWorkspaceGrantSpy.mockResolvedValue(true);

      const formData = new FormData();
      formData.set("displayName", "Local User");
      formData.set("email", "user@example.com");
      formData.set("next", "/onboarding/cli/approve?code=abc123");

      await expect(localDevSignup(formData)).rejects.toThrow(
        "/login?ok=local_signup_created&next=%2Fonboarding%2Fcli%2Fapprove%3Fcode%3Dabc123",
      );
      expect(redirectSpy).toHaveBeenCalledWith(
        "/login?ok=local_signup_created&next=%2Fonboarding%2Fcli%2Fapprove%3Fcode%3Dabc123",
      );
    });

    it("redirects back to signup with next parameter preserved on validation failure", async () => {
      const formData = new FormData();
      formData.set("displayName", "Local User");
      formData.set("email", "invalid-email");
      formData.set("next", "/onboarding/cli/approve?code=abc123");

      await expect(localDevSignup(formData)).rejects.toThrow(
        "/signup?error=invalid_input&next=%2Fonboarding%2Fcli%2Fapprove%3Fcode%3Dabc123",
      );
      expect(redirectSpy).toHaveBeenCalledWith(
        "/signup?error=invalid_input&next=%2Fonboarding%2Fcli%2Fapprove%3Fcode%3Dabc123",
      );
    });
  });

  describe("loginWithPrincipal", () => {
    it("redirects to valid relative next URL after successful sign in", async () => {
      getPrincipalForLoginSpy.mockResolvedValue({
        id: "p-123",
        tenant_id: "demo-tenant",
        subject: "user@example.com",
        require_mfa: false,
        disabled_at: null,
      });

      const formData = new FormData();
      formData.set("principalId", "p-123");
      formData.set("next", "/onboarding/cli/approve?code=abc123");

      await expect(loginWithPrincipal(null, formData)).rejects.toThrow(
        "/onboarding/cli/approve?code=abc123",
      );
      expect(redirectSpy).toHaveBeenCalledWith("/onboarding/cli/approve?code=abc123");
      // Sign-in itself no longer seeds; createAuthSession owns the baseline.
      // See tests/workspace-policy-baseline.test.mts.
      expect(ensureDefaultPublishedPolicyPackSpy).not.toHaveBeenCalled();
    });

    it("sanitizes open redirects by falling back to root", async () => {
      getPrincipalForLoginSpy.mockResolvedValue({
        id: "p-123",
        tenant_id: "demo-tenant",
        subject: "user@example.com",
        require_mfa: false,
        disabled_at: null,
      });

      const formData = new FormData();
      formData.set("principalId", "p-123");
      formData.set("next", "https://attacker.com/malicious");

      await expect(loginWithPrincipal(null, formData)).rejects.toThrow("/");
      expect(redirectSpy).toHaveBeenCalledWith("/");
    });

    it("sanitizes protocol-less absolute redirects (//attacker.com) to prevent browser bypassing", async () => {
      getPrincipalForLoginSpy.mockResolvedValue({
        id: "p-123",
        tenant_id: "demo-tenant",
        subject: "user@example.com",
        require_mfa: false,
        disabled_at: null,
      });

      const formData = new FormData();
      formData.set("principalId", "p-123");
      formData.set("next", "//attacker.com/malicious");

      await expect(loginWithPrincipal(null, formData)).rejects.toThrow("/");
      expect(redirectSpy).toHaveBeenCalledWith("/");
    });

    it("forwards next parameter to MFA page if MFA is required", async () => {
      getPrincipalForLoginSpy.mockResolvedValue({
        id: "p-123",
        tenant_id: "demo-tenant",
        subject: "user@example.com",
        require_mfa: true,
        disabled_at: null,
      });

      const formData = new FormData();
      formData.set("principalId", "p-123");
      formData.set("next", "/onboarding/cli/approve?code=abc123");

      await expect(loginWithPrincipal(null, formData)).rejects.toThrow(
        "/login?mfa=required&next=%2Fonboarding%2Fcli%2Fapprove%3Fcode%3Dabc123",
      );
      expect(redirectSpy).toHaveBeenCalledWith(
        "/login?mfa=required&next=%2Fonboarding%2Fcli%2Fapprove%3Fcode%3Dabc123",
      );
    });
  });

  describe("launchDemoCloud", () => {
    it("creates a demo owner session, pins demo tenant/workspace cookies, and redirects home", async () => {
      getPrincipalForLoginSpy.mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000013",
        tenant_id: "demo-tenant",
        subject: "nora-workspace-owner",
        require_mfa: false,
        disabled_at: null,
      });

      await expect(launchDemoCloud()).rejects.toThrow("/");

      expect(createAuthSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          principalId: "00000000-0000-0000-0000-000000000013",
          tenantId: "demo-tenant",
          authMethod: "SESSION",
        }),
      );
      expect(cookieSetSpy).toHaveBeenCalledWith(
        "spctre_tenant_id",
        "demo-tenant",
        expect.any(Object),
      );
      expect(cookieSetSpy).toHaveBeenCalledWith(
        "spctre_workspace_id",
        "demo-workspace",
        expect.any(Object),
      );
      expect(redirectSpy).toHaveBeenCalledWith("/");
    });
  });
});
