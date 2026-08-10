import { describe, expect, it, vi, beforeEach } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000101";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000102";
const PRINCIPAL_ID = "00000000-0000-0000-0000-000000000103";

const ensureDefaultPublishedPolicyPackSpy = vi.fn();
const getLatestPublishedBundleSpy = vi.fn();
const getPrimaryWorkspaceIdForTenantSpy = vi.fn();
const markSessionMfaVerifiedRowSpy = vi.fn(async () => "ok" as const);

vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: ensureDefaultPublishedPolicyPackSpy,
}));

vi.mock("@/lib/repositories/policy/publish", () => ({
  getLatestPublishedBundle: getLatestPublishedBundleSpy,
}));

vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: () => true,
}));

vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "demo-tenant",
  DEMO_WORKSPACE_ID: "demo-workspace",
  DEMO_PRINCIPAL_IDS: {},
}));

// Preserve the real tenant binding contract: the callback must run inside a
// context bound to the tenant being seeded.
const boundTenants: string[] = [];
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: async (tenantId: string, fn: () => Promise<unknown>) => {
    boundTenants.push(tenantId);
    return fn();
  },
}));

vi.mock("@/lib/repositories/auth/session", () => ({
  getPrimaryWorkspaceIdForTenant: getPrimaryWorkspaceIdForTenantSpy,
  ensureAuthDemoTenant: vi.fn(),
  getPrincipalForLogin: vi.fn(),
  getTenantRequireMfa: vi.fn(),
  isAuthDatabaseConfigured: () => true,
  resolveTenantIdOrDemo: vi.fn(),
}));

vi.mock("@/lib/repositories/mfa", () => ({
  markSessionMfaVerified: markSessionMfaVerifiedRowSpy,
}));

const { ensureWorkspacePolicyBaseline } = await import("@/lib/domains/auth/service");

describe("workspace policy baseline", () => {
  beforeEach(() => {
    ensureDefaultPublishedPolicyPackSpy.mockReset();
    getLatestPublishedBundleSpy.mockReset();
    getPrimaryWorkspaceIdForTenantSpy.mockReset();
    getPrimaryWorkspaceIdForTenantSpy.mockResolvedValue(WORKSPACE_ID);
    boundTenants.length = 0;
  });

  it("seeds the baseline when the workspace has never published", async () => {
    getLatestPublishedBundleSpy.mockResolvedValue(null);

    await ensureWorkspacePolicyBaseline({ tenantId: TENANT_ID, principalId: PRINCIPAL_ID });

    expect(ensureDefaultPublishedPolicyPackSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      actorId: PRINCIPAL_ID,
    });
  });

  it("binds the tenant before writing, so the seeding is not blocked by RLS", async () => {
    getLatestPublishedBundleSpy.mockResolvedValue(null);

    await ensureWorkspacePolicyBaseline({ tenantId: TENANT_ID, principalId: PRINCIPAL_ID });

    expect(boundTenants).toEqual([TENANT_ID]);
  });

  it("does nothing when a bundle is already published", async () => {
    getLatestPublishedBundleSpy.mockResolvedValue({ artifactHash: "sha256:abc" });

    await ensureWorkspacePolicyBaseline({ tenantId: TENANT_ID, principalId: PRINCIPAL_ID });

    expect(ensureDefaultPublishedPolicyPackSpy).not.toHaveBeenCalled();
  });

  it("skips the demo tenant", async () => {
    getLatestPublishedBundleSpy.mockResolvedValue(null);

    await ensureWorkspacePolicyBaseline({ tenantId: "demo-tenant", principalId: PRINCIPAL_ID });

    expect(ensureDefaultPublishedPolicyPackSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the tenant has no workspace yet", async () => {
    getPrimaryWorkspaceIdForTenantSpy.mockResolvedValue(null);

    await ensureWorkspacePolicyBaseline({ tenantId: TENANT_ID, principalId: PRINCIPAL_ID });

    expect(getLatestPublishedBundleSpy).not.toHaveBeenCalled();
    expect(ensureDefaultPublishedPolicyPackSpy).not.toHaveBeenCalled();
  });
});

describe("markSessionMfaVerified", () => {
  beforeEach(() => {
    ensureDefaultPublishedPolicyPackSpy.mockReset();
    getLatestPublishedBundleSpy.mockReset();
    getLatestPublishedBundleSpy.mockResolvedValue(null);
    getPrimaryWorkspaceIdForTenantSpy.mockReset();
    getPrimaryWorkspaceIdForTenantSpy.mockResolvedValue(WORKSPACE_ID);
    markSessionMfaVerifiedRowSpy.mockClear();
    boundTenants.length = 0;
  });

  it("seeds the baseline that session creation deferred while MFA was outstanding", async () => {
    const { markSessionMfaVerified } = await import("@/lib/domains/auth/service");

    const result = await markSessionMfaVerified({
      sessionId: "session-1",
      tenantId: TENANT_ID,
      principalId: PRINCIPAL_ID,
    });

    expect(result).toBe("ok");
    expect(markSessionMfaVerifiedRowSpy).toHaveBeenCalledWith({
      sessionId: "session-1",
      tenantId: TENANT_ID,
    });
    expect(ensureDefaultPublishedPolicyPackSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      actorId: PRINCIPAL_ID,
    });
  });

  it("does not seed when the session row could not be marked verified", async () => {
    markSessionMfaVerifiedRowSpy.mockResolvedValueOnce("db-unavailable" as never);
    const { markSessionMfaVerified } = await import("@/lib/domains/auth/service");

    const result = await markSessionMfaVerified({
      sessionId: "session-1",
      tenantId: TENANT_ID,
      principalId: PRINCIPAL_ID,
    });

    expect(result).toBe("db-unavailable");
    expect(ensureDefaultPublishedPolicyPackSpy).not.toHaveBeenCalled();
  });
});
