import { beforeEach, describe, expect, it, vi } from "vitest";

// The account surface, where the failure mode is locking someone out of their
// own tenant.
//
// Two paths carry that weight. Unlinking a social identity has to refuse when
// it would remove the last way in — the client hides the button, which is not a
// guard. And local-dev signup binds a tenant it has only just created, because
// nothing has bound one yet at that point in the flow; this is the shape that
// shipped once as "No tenant context is bound" on a first signup.

const isDatabaseConfiguredSpy = vi.fn();
const listPrincipalPasskeysSpy = vi.fn();
const listLinkedSocialIdentitiesSpy = vi.fn();
const repoUnlinkSocialIdentitySpy = vi.fn();
const deletePrincipalPasskeySpy = vi.fn();
const renamePasskeySpy = vi.fn();
const deletePrincipalMfaEnrollmentSpy = vi.fn();
const ensureLocalDevTenantWorkspaceSpy = vi.fn();
const upsertLocalDevPrincipalSpy = vi.fn();
const upsertLocalDevWorkspaceGrantSpy = vi.fn();
const ensureDefaultPublishedPolicyPackSpy = vi.fn();
const recordConversionTelemetrySpy = vi.fn();
const ensureAuthDemoTenantSpy = vi.fn();
const revokeServiceTokenAndRefreshSpy = vi.fn();
const runWithTenantContextSpy = vi.fn(async (_tenantId: string, fn: () => unknown) => fn());

vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: isDatabaseConfiguredSpy,
}));
vi.mock("@/lib/repositories/mfa", () => ({
  listPrincipalPasskeys: listPrincipalPasskeysSpy,
  deletePrincipalPasskey: deletePrincipalPasskeySpy,
  renamePasskey: renamePasskeySpy,
  listMfaEnrollments: vi.fn(),
  deletePrincipalMfaEnrollment: deletePrincipalMfaEnrollmentSpy,
  upsertPasskeyCredential: vi.fn(),
  getPasskeyCredential: vi.fn(),
}));
vi.mock("@/lib/repositories/auth/principal", () => ({
  listLinkedSocialIdentities: listLinkedSocialIdentitiesSpy,
  unlinkSocialIdentity: repoUnlinkSocialIdentitySpy,
  ensureLocalDevTenantWorkspace: ensureLocalDevTenantWorkspaceSpy,
  upsertLocalDevPrincipal: upsertLocalDevPrincipalSpy,
  getPrincipalSubject: vi.fn(),
  findUserPrincipalIdByIdentifier: vi.fn(),
  linkSocialIdentity: vi.fn(),
  upsertOidcPrincipal: vi.fn(),
  findPrincipalByEmail: vi.fn(),
}));
vi.mock("@/lib/repositories/auth/session", () => ({
  listPrincipalSessions: vi.fn(),
  revokeSessionAndRecord: vi.fn(),
  ensureAuthDemoTenant: ensureAuthDemoTenantSpy,
  getPrincipalForLogin: vi.fn(),
  getPrimaryWorkspaceIdForTenant: vi.fn(),
  resolveTenantIdOrDemo: vi.fn(),
  isAuthDatabaseConfigured: vi.fn(),
  getTenantRequireMfa: vi.fn(),
}));
vi.mock("@/lib/repositories/auth/grants", () => ({
  upsertLocalDevWorkspaceGrant: upsertLocalDevWorkspaceGrantSpy,
  ensurePrincipalPermissionGrant: vi.fn(),
}));
vi.mock("@/lib/repositories/auth/service-keys", () => ({
  listActiveApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
  revokeServiceTokenAndRefresh: revokeServiceTokenAndRefreshSpy,
  listRevocationHistory: vi.fn(),
}));
vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: ensureDefaultPublishedPolicyPackSpy,
}));
vi.mock("@/lib/repositories/onboarding/telemetry", () => ({
  recordConversionTelemetry: recordConversionTelemetrySpy,
}));
vi.mock("@/lib/repositories/auth/recovery", () => ({ countUnusedRecoveryCodes: vi.fn() }));
vi.mock("@/lib/repositories/identity-providers", () => ({
  listIdentityProviders: vi.fn(),
  upsertSamlIdentityProvider: vi.fn(),
  upsertOidcIdentityProvider: vi.fn(),
  deleteIdentityProviderById: vi.fn(),
  countIdentityProvidersByType: vi.fn(),
  setTenantAuthFlag: vi.fn(),
}));
vi.mock("@/lib/repositories/operations-log", () => ({ appendOperationsLog: vi.fn() }));
vi.mock("@/lib/repositories/policy/publish", () => ({ getLatestPublishedBundle: vi.fn() }));
vi.mock("@/lib/repositories/auth/webauthn-challenge", () => ({
  consumeWebauthnChallenge: vi.fn(),
  saveWebauthnChallenge: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({ runWithTenantContext: runWithTenantContextSpy }));

const service = await import("../lib/domains/auth/service");

const TENANT = "tenant-1";
const PRINCIPAL = "principal-1";

beforeEach(() => {
  vi.clearAllMocks();
  isDatabaseConfiguredSpy.mockReturnValue(true);
  listPrincipalPasskeysSpy.mockResolvedValue([]);
  listLinkedSocialIdentitiesSpy.mockResolvedValue([]);
  repoUnlinkSocialIdentitySpy.mockResolvedValue(undefined);
  ensureAuthDemoTenantSpy.mockResolvedValue(undefined);
  ensureLocalDevTenantWorkspaceSpy.mockResolvedValue({
    tenantId: "tenant-new",
    workspaceId: "workspace-new",
  });
  upsertLocalDevPrincipalSpy.mockResolvedValue("principal-new");
  upsertLocalDevWorkspaceGrantSpy.mockResolvedValue(undefined);
  ensureDefaultPublishedPolicyPackSpy.mockResolvedValue(undefined);
  recordConversionTelemetrySpy.mockResolvedValue(undefined);
});

describe("unlinking the last way in", () => {
  it("refuses when no passkey and no other identity would remain", async () => {
    // The button is hidden client-side when this is the case; that is a
    // courtesy, not a guard, and the request can still be made.
    listLinkedSocialIdentitiesSpy.mockResolvedValue([{ provider: "GOOGLE" }]);

    const result = await service.unlinkSocialIdentity({
      principalId: PRINCIPAL,
      tenantId: TENANT,
      provider: "GOOGLE",
    });

    expect(result).toEqual({ error: "Cannot remove the last authentication method." });
    expect(repoUnlinkSocialIdentitySpy).not.toHaveBeenCalled();
  });

  it("allows it when a passkey remains", async () => {
    listPrincipalPasskeysSpy.mockResolvedValue([{ id: "passkey-1" }]);
    listLinkedSocialIdentitiesSpy.mockResolvedValue([{ provider: "GOOGLE" }]);

    const result = await service.unlinkSocialIdentity({
      principalId: PRINCIPAL,
      tenantId: TENANT,
      provider: "GOOGLE",
    });

    expect(result).toEqual({ ok: true });
    expect(repoUnlinkSocialIdentitySpy).toHaveBeenCalled();
  });

  it("allows it when another identity remains", async () => {
    listLinkedSocialIdentitiesSpy.mockResolvedValue([
      { provider: "GOOGLE" },
      { provider: "GITHUB" },
    ]);

    const result = await service.unlinkSocialIdentity({
      principalId: PRINCIPAL,
      tenantId: TENANT,
      provider: "GOOGLE",
    });

    expect(result).toEqual({ ok: true });
  });

  it("counts what remains after this provider is gone, not what exists now", async () => {
    // Counting the current list would let the last identity be removed, since
    // the list is non-empty right up to the moment it is deleted.
    listLinkedSocialIdentitiesSpy.mockResolvedValue([{ provider: "GITHUB" }]);

    const result = await service.unlinkSocialIdentity({
      principalId: PRINCIPAL,
      tenantId: TENANT,
      provider: "GITHUB",
    });

    expect(result).toEqual({ error: "Cannot remove the last authentication method." });
  });

  it("treats an unreadable identity list as empty rather than failing open", async () => {
    listLinkedSocialIdentitiesSpy.mockRejectedValue(new Error("db down"));

    const result = await service.unlinkSocialIdentity({
      principalId: PRINCIPAL,
      tenantId: TENANT,
      provider: "GOOGLE",
    });

    expect(result).toEqual({ error: "Cannot remove the last authentication method." });
    expect(repoUnlinkSocialIdentitySpy).not.toHaveBeenCalled();
  });
});

describe("local-dev signup binds the tenant it just created", () => {
  it("binds before the writes that row-level security gates", async () => {
    // Nothing has bound a tenant at signup: there is no session yet. The writes
    // below are RLS-gated, so an unbound one is refused rather than empty.
    const result = await service.createLocalDevSignup({
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result).toEqual({ ok: true });
    expect(runWithTenantContextSpy).toHaveBeenCalledWith("tenant-new", expect.any(Function));
    expect(upsertLocalDevPrincipalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-new" }),
    );
    expect(upsertLocalDevWorkspaceGrantSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-new", principalId: "principal-new" }),
    );
  });

  it("seeds a default policy pack so the new workspace is not empty", async () => {
    await service.createLocalDevSignup({ displayName: "Ada", email: "ada@example.com" });

    expect(ensureDefaultPublishedPolicyPackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-new", workspaceId: "workspace-new" }),
    );
  });

  it("reports database_required rather than half-creating an account", async () => {
    isDatabaseConfiguredSpy.mockReturnValue(false);

    const result = await service.createLocalDevSignup({
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result).toEqual({ error: "database_required" });
    expect(ensureLocalDevTenantWorkspaceSpy).not.toHaveBeenCalled();
  });

  it("stops when the workspace could not be created", async () => {
    ensureLocalDevTenantWorkspaceSpy.mockResolvedValue(null);

    const result = await service.createLocalDevSignup({
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result).toEqual({ error: "create_failed" });
    expect(runWithTenantContextSpy).not.toHaveBeenCalled();
  });

  it("stops when the principal could not be created, before granting anything", async () => {
    upsertLocalDevPrincipalSpy.mockResolvedValue(null);

    const result = await service.createLocalDevSignup({
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result).toEqual({ error: "create_failed" });
    expect(upsertLocalDevWorkspaceGrantSpy).not.toHaveBeenCalled();
  });

  it("completes signup even when telemetry fails", async () => {
    // Conversion telemetry is a reporting concern. Failing signup for it would
    // trade an account for a metric.
    recordConversionTelemetrySpy.mockRejectedValue(new Error("telemetry down"));

    const result = await service.createLocalDevSignup({
      displayName: "Ada",
      email: "ada@example.com",
    });

    expect(result).toEqual({ ok: true });
  });
});

describe("credential removal needs a database", () => {
  it.each([
    [
      "deletePasskey",
      () => service.deletePasskey({ passkeyId: "p", tenantId: TENANT, principalId: PRINCIPAL }),
    ],
    [
      "renamePasskey",
      () =>
        service.renamePasskey({
          passkeyId: "p",
          tenantId: TENANT,
          principalId: PRINCIPAL,
          name: "n",
        }),
    ],
    [
      "deleteMfaEnrollment",
      () =>
        service.deleteMfaEnrollment({
          enrollmentId: "e",
          tenantId: TENANT,
          principalId: PRINCIPAL,
        }),
    ],
    [
      "unlinkSocialIdentity",
      () =>
        service.unlinkSocialIdentity({
          principalId: PRINCIPAL,
          tenantId: TENANT,
          provider: "GOOGLE",
        }),
    ],
  ])("%s reports it rather than claiming success", async (_label, call) => {
    isDatabaseConfiguredSpy.mockReturnValue(false);

    await expect(call()).resolves.toEqual({ error: "Database not configured." });
    expect(deletePrincipalPasskeySpy).not.toHaveBeenCalled();
    expect(deletePrincipalMfaEnrollmentSpy).not.toHaveBeenCalled();
    expect(repoUnlinkSocialIdentitySpy).not.toHaveBeenCalled();
  });
});

describe("revoking a bearer token", () => {
  it("binds the tenant, since the caller may have no session", async () => {
    revokeServiceTokenAndRefreshSpy.mockResolvedValue({ revoked: true });

    await service.revokeBearerServiceToken({ tokenId: "token-1", tenantId: TENANT });

    expect(runWithTenantContextSpy).toHaveBeenCalledWith(TENANT, expect.any(Function));
    expect(revokeServiceTokenAndRefreshSpy).toHaveBeenCalledWith("token-1");
  });
});
