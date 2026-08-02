import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rawSqlMock,
  sqlMock,
  txMock,
  runWithTenantContextMock,
  ensureDemoTenantMock,
  issueAccessRefreshPairMock,
  ensureStarterPublishedBundleMock,
} = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { begin: vi.fn() });
  return {
    rawSqlMock: vi.fn(),
    sqlMock,
    txMock: vi.fn(),
    runWithTenantContextMock: vi.fn(async (_tenantId: string, work: () => Promise<unknown>) => work()),
    ensureDemoTenantMock: vi.fn(async () => true),
    issueAccessRefreshPairMock: vi.fn(),
    ensureStarterPublishedBundleMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  rawSql: rawSqlMock,
  sql: sqlMock,
  runWithTenantContext: runWithTenantContextMock,
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({
  ensureDemoTenant: ensureDemoTenantMock,
}));

vi.mock("@/lib/service-tokens", () => ({
  issueAccessRefreshPair: issueAccessRefreshPairMock,
}));

vi.mock("@/lib/repositories/onboarding/shared", () => ({
  ONBOARDING_TTL_MINUTES: 10,
  ensureStarterPublishedBundle: ensureStarterPublishedBundleMock,
  slugifyWorkspace: (value: string) => value.trim().toLowerCase(),
}));

const { exchangeCliOnboardingCode, startCliOnboarding } = await import("../lib/repositories/onboarding/cli");

describe("CLI onboarding pre-session persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rawSqlMock.mockResolvedValue([]);
    sqlMock.begin.mockImplementation(async (work: (tx: typeof txMock) => Promise<unknown>) => work(txMock));
    txMock.mockResolvedValue([]);
    issueAccessRefreshPairMock.mockResolvedValue({
      accessToken: "access-token",
      accessTokenId: "access-token-id",
      accessTokenExpiresAt: "2026-08-03T00:00:00.000Z",
      refreshToken: "refresh-token",
      refreshTokenId: "refresh-token-id",
      refreshTokenExpiresAt: "2026-11-01T00:00:00.000Z",
    });
    ensureStarterPublishedBundleMock.mockResolvedValue({
      artifactHash: "artifact-hash",
      branchId: "branch-id",
      revisionId: "revision-id",
    });
  });

  it("stores the initial opaque request through the owner connection", async () => {
    await expect(startCliOnboarding({
      controlPlaneUrl: "https://app-staging.spctre.dev",
      workspaceSlug: "acquisition",
      agentId: "solo-agent",
      environment: "production",
      bundlePath: "spctre-policy.json",
    })).resolves.toMatchObject({
      approveUrl: expect.stringContaining("/onboarding/cli/approve?code="),
    });

    expect(rawSqlMock).toHaveBeenCalledOnce();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("looks up the opaque exchange code through rawSql, then binds issuance to its approved tenant", async () => {
    rawSqlMock.mockResolvedValueOnce([{
      id: "request-1",
      requested_agent_id: "solo-agent",
      requested_environment: "production",
      requested_bundle_path: "spctre-policy.json",
      approved_tenant_id: "tenant-1",
      approved_workspace_id: "workspace-1",
      approved_by: "principal-1",
      trial: false,
    }]);
    txMock.mockResolvedValueOnce([{ id: "service-principal-1" }]);
    sqlMock.mockResolvedValueOnce([{ slug: "acquisition" }]);

    await expect(exchangeCliOnboardingCode("opaque-code")).resolves.toMatchObject({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      workspaceSlug: "acquisition",
      token: "access-token",
    });

    expect(rawSqlMock).toHaveBeenCalledOnce();
    expect(sqlMock.begin).toHaveBeenCalledOnce();
    expect(runWithTenantContextMock).toHaveBeenCalled();
    expect(runWithTenantContextMock.mock.calls.every(([tenantId]) => tenantId === "tenant-1")).toBe(true);
  });
});
