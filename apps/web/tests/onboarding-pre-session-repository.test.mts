import { beforeEach, describe, expect, it, vi } from "vitest";

const { rawSqlMock, sqlMock, ensureDemoTenantMock } = vi.hoisted(() => ({
  rawSqlMock: vi.fn(),
  sqlMock: vi.fn(),
  ensureDemoTenantMock: vi.fn(async () => true),
}));

vi.mock("@/lib/db", () => ({
  rawSql: rawSqlMock,
  sql: sqlMock,
  runWithTenantContext: async (_tenantId: string, work: () => Promise<unknown>) => work(),
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({
  ensureDemoTenant: ensureDemoTenantMock,
}));

const { startCliOnboarding } = await import("../lib/repositories/onboarding/cli");

describe("CLI onboarding pre-session persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rawSqlMock.mockResolvedValue([]);
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
});
