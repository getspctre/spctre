import { beforeEach, describe, expect, it, vi } from "vitest";

const deletePrincipalPasskeySpy = vi.fn();
const renamePasskeySpy = vi.fn();
const deletePrincipalMfaEnrollmentSpy = vi.fn();
const listPrincipalPasskeysSpy = vi.fn();
const listMfaEnrollmentsSpy = vi.fn();
const listLinkedSocialIdentitiesSpy = vi.fn();
const unlinkSocialIdentitySpy = vi.fn();
const listPrincipalSessionsSpy = vi.fn();
const revokeSessionAndRecordSpy = vi.fn();
const countUnusedRecoveryCodesSpy = vi.fn();
const isDatabaseConfiguredSpy = vi.fn();

const listIdentityProvidersSpy = vi.fn();
const getTenantMfaSettingsSpy = vi.fn();
const upsertSamlIdentityProviderSpy = vi.fn();
const upsertOidcIdentityProviderSpy = vi.fn();
const deleteIdentityProviderByIdSpy = vi.fn();
const countIdentityProvidersByTypeSpy = vi.fn();
const setTenantAuthFlagSpy = vi.fn();
const setTenantMfaPolicySpy = vi.fn();
const ensureAuthDemoTenantSpy = vi.fn();
const getPrincipalForLoginSpy = vi.fn();
const getPrimaryWorkspaceIdForTenantSpy = vi.fn();
const getVerifiedMfaEnrollmentsSpy = vi.fn();
const updateSmsEnrollmentSecretSpy = vi.fn();
const markSessionMfaVerifiedSpy = vi.fn();
const ensureDefaultPublishedPolicyPackSpy = vi.fn();

vi.mock("@/lib/repositories/mfa", () => ({
  deletePrincipalPasskey: deletePrincipalPasskeySpy,
  renamePasskey: renamePasskeySpy,
  deletePrincipalMfaEnrollment: deletePrincipalMfaEnrollmentSpy,
  listPrincipalPasskeys: listPrincipalPasskeysSpy,
  listMfaEnrollments: listMfaEnrollmentsSpy,
  getTenantMfaSettings: getTenantMfaSettingsSpy,
  setTenantMfaPolicy: setTenantMfaPolicySpy,
  getVerifiedMfaEnrollments: getVerifiedMfaEnrollmentsSpy,
  updateSmsEnrollmentSecret: updateSmsEnrollmentSecretSpy,
  markSessionMfaVerified: markSessionMfaVerifiedSpy,
}));
vi.mock("@/lib/repositories/auth/principal", () => ({
  listLinkedSocialIdentities: listLinkedSocialIdentitiesSpy,
  unlinkSocialIdentity: unlinkSocialIdentitySpy,
}));
vi.mock("@/lib/repositories/auth/session", () => ({
  listPrincipalSessions: listPrincipalSessionsSpy,
  revokeSessionAndRecord: revokeSessionAndRecordSpy,
  ensureAuthDemoTenant: ensureAuthDemoTenantSpy,
  getPrincipalForLogin: getPrincipalForLoginSpy,
  getPrimaryWorkspaceIdForTenant: getPrimaryWorkspaceIdForTenantSpy,
}));
vi.mock("@/lib/repositories/auth/recovery", () => ({
  countUnusedRecoveryCodes: countUnusedRecoveryCodesSpy,
}));
vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: isDatabaseConfiguredSpy,
}));
vi.mock("@/lib/repositories/identity-providers", () => ({
  listIdentityProviders: listIdentityProvidersSpy,
  upsertSamlIdentityProvider: upsertSamlIdentityProviderSpy,
  upsertOidcIdentityProvider: upsertOidcIdentityProviderSpy,
  deleteIdentityProviderById: deleteIdentityProviderByIdSpy,
  countIdentityProvidersByType: countIdentityProvidersByTypeSpy,
  setTenantAuthFlag: setTenantAuthFlagSpy,
}));
vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: ensureDefaultPublishedPolicyPackSpy,
}));

vi.mock("@/lib/totp", () => ({
  verifyTotpCode: vi.fn(({ code }) => code === "123456"),
}));

const authService = await import("../lib/domains/auth/service");

describe("auth domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDatabaseConfiguredSpy.mockReturnValue(true);
  });

  describe("getAccountPageModel", () => {
    it("returns empty model when database is not configured", async () => {
      isDatabaseConfiguredSpy.mockReturnValue(false);
      const model = await authService.getAccountPageModel("user1", "tenant1");
      expect(model).toEqual({
        passkeys: [],
        enrollments: [],
        unusedRecoveryCodes: 0,
        linkedIdentities: [],
        activeSessions: [],
      });
      expect(listPrincipalPasskeysSpy).not.toHaveBeenCalled();
    });

    it("aggregates data correctly when database is configured", async () => {
      listPrincipalPasskeysSpy.mockResolvedValue([{ id: "pk1" }]);
      listMfaEnrollmentsSpy.mockResolvedValue([{ id: "mfa1" }]);
      countUnusedRecoveryCodesSpy.mockResolvedValue(4);
      listLinkedSocialIdentitiesSpy.mockResolvedValue([{ provider: "GOOGLE" }]);
      listPrincipalSessionsSpy.mockResolvedValue([{ id: "sess1" }]);

      const model = await authService.getAccountPageModel("user1", "tenant1");

      expect(model).toEqual({
        passkeys: [{ id: "pk1" }],
        enrollments: [{ id: "mfa1" }],
        unusedRecoveryCodes: 4,
        linkedIdentities: [{ provider: "GOOGLE" }],
        activeSessions: [{ id: "sess1" }],
      });
    });
  });

  describe("deletePasskey", () => {
    it("returns error when database is not configured", async () => {
      isDatabaseConfiguredSpy.mockReturnValue(false);
      const result = await authService.deletePasskey({ passkeyId: "pk1", tenantId: "t1", principalId: "u1" });
      expect(result).toEqual({ error: "Database not configured." });
    });

    it("reports successful passkey removal", async () => {
      deletePrincipalPasskeySpy.mockResolvedValue(true);
      const result = await authService.deletePasskey({ passkeyId: "pk1", tenantId: "t1", principalId: "u1" });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("renamePasskey", () => {
    it("reports successful passkey rename", async () => {
      renamePasskeySpy.mockResolvedValue(true);
      const result = await authService.renamePasskey({ passkeyId: "pk1", name: "New Name", tenantId: "t1", principalId: "u1" });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("deleteMfaEnrollment", () => {
    it("reports successful MFA enrollment removal", async () => {
      deletePrincipalMfaEnrollmentSpy.mockResolvedValue(true);
      const result = await authService.deleteMfaEnrollment({ enrollmentId: "mfa1", tenantId: "t1", principalId: "u1" });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("unlinkSocialIdentity", () => {
    it("guards against removing last authentication method", async () => {
      listPrincipalPasskeysSpy.mockResolvedValue([]); // no passkeys
      listLinkedSocialIdentitiesSpy.mockResolvedValue([{ provider: "GOOGLE" }]); // only GOOGLE linked

      const result = await authService.unlinkSocialIdentity({
        principalId: "u1",
        tenantId: "t1",
        provider: "GOOGLE",
      });

      expect(result).toEqual({ error: "Cannot remove the last authentication method." });
      expect(unlinkSocialIdentitySpy).not.toHaveBeenCalled();
    });

    it("allows unlinking when other authentication methods exist", async () => {
      listPrincipalPasskeysSpy.mockResolvedValue([{ id: "pk1" }]); // has passkey
      listLinkedSocialIdentitiesSpy.mockResolvedValue([{ provider: "GOOGLE" }]);

      const result = await authService.unlinkSocialIdentity({
        principalId: "u1",
        tenantId: "t1",
        provider: "GOOGLE",
      });

      expect(result).toEqual({ ok: true });
    });
  });

  describe("revokeSession", () => {
    it("guards against revoking active session", async () => {
      const result = await authService.revokeSession({
        sessionId: "sess-active",
        currentSessionId: "sess-active",
        tenantId: "t1",
        principalId: "u1",
      });

      expect(result).toEqual({ error: "Cannot revoke active session" });
      expect(revokeSessionAndRecordSpy).not.toHaveBeenCalled();
    });

    it("allows revoking non-active sessions", async () => {
      const result = await authService.revokeSession({
        sessionId: "sess-other",
        currentSessionId: "sess-active",
        tenantId: "t1",
        principalId: "u1",
      });

      expect(result).toEqual({ ok: true });
    });
  });

  describe("getAdminAuthPageModel", () => {
    it("returns correct structure", async () => {
      listIdentityProvidersSpy.mockResolvedValue([{ id: "idp1" }]);
      getTenantMfaSettingsSpy.mockResolvedValue({ requireMfa: true, mfaGraceDays: 14 });

      const model = await authService.getAdminAuthPageModel("t1");
      expect(model).toEqual({
        providers: [{ id: "idp1" }],
        tenantMfa: { requireMfa: true, mfaGraceDays: 14 },
      });
    });
  });

  describe("deleteIdentityProvider", () => {
    it("deletes and updates tenant auth flag when provider type matches", async () => {
      deleteIdentityProviderByIdSpy.mockResolvedValue("OIDC");
      countIdentityProvidersByTypeSpy.mockResolvedValue(0);

      const result = await authService.deleteIdentityProvider({ tenantId: "t1", providerId: "idp1" });

      expect(result).toEqual({ ok: true });
      // The observable contract is that the tenant flag is disabled when the
      // final provider is removed; the repository call sequence is private.
      expect(setTenantAuthFlagSpy).toHaveBeenCalledWith({ tenantId: "t1", flag: "oidc_enabled", value: false });
    });
  });

  describe("verifyMfaLoginCode", () => {
    it("returns error on invalid code format", async () => {
      const result = await authService.verifyMfaLoginCode({
        sessionId: "s1",
        tenantId: "t1",
        principalId: "u1",
        code: "invalid",
        factor: "totp",
      });

      expect(result).toEqual({ error: "Enter a valid 6-digit code." });
    });

    it("verifies TOTP code and marks session verified", async () => {
      getVerifiedMfaEnrollmentsSpy.mockResolvedValue([{ mfa_type: "TOTP", secret_enc: "secret32" }]);
      const result = await authService.verifyMfaLoginCode({
        sessionId: "s1",
        tenantId: "t1",
        principalId: "u1",
        code: "123456",
        factor: "totp",
      });

      expect(result).toEqual({ ok: true });
      expect(markSessionMfaVerifiedSpy).toHaveBeenCalledWith({ sessionId: "s1", tenantId: "t1" });
    });
  });
});
