import { beforeEach, describe, expect, it, vi } from "vitest";

const { runWithTenantContextMock, sqlMock } = vi.hoisted(() => ({
  runWithTenantContextMock: vi.fn(async (_tenantId: string, work: () => Promise<unknown>) =>
    work(),
  ),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  rawSql: vi.fn(),
  runWithTenantContext: runWithTenantContextMock,
  sql: sqlMock,
}));

const { getTenantPrincipalBySubject, getTenantRequireMfa } =
  await import("../lib/repositories/auth/session");
const { findUserPrincipalIdByIdentifier } = await import("../lib/repositories/auth/principal");

describe("tenant-known pre-session auth lookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds the trusted provider tenant before reading its MFA requirement", async () => {
    sqlMock.mockResolvedValue([{ require_mfa: true }]);

    await expect(getTenantRequireMfa("tenant-1")).resolves.toBe(true);

    expect(runWithTenantContextMock).toHaveBeenCalledWith("tenant-1", expect.any(Function));
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it("binds the target tenant before looking up a principal by subject", async () => {
    sqlMock.mockResolvedValue([
      { id: "tenant-2", principal_id: "principal-2", principal_subject: "user@example.com" },
    ]);

    await expect(
      getTenantPrincipalBySubject({ tenantId: "tenant-2", subject: "user@example.com" }),
    ).resolves.toMatchObject({ id: "tenant-2", principal_id: "principal-2" });

    expect(runWithTenantContextMock).toHaveBeenCalledWith("tenant-2", expect.any(Function));
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it("binds the trusted tenant before resolving a login identifier", async () => {
    sqlMock.mockResolvedValue([{ id: "principal-3" }]);

    await expect(
      findUserPrincipalIdByIdentifier({ tenantId: "tenant-3", identifier: "user@example.com" }),
    ).resolves.toBe("principal-3");

    expect(runWithTenantContextMock).toHaveBeenCalledWith("tenant-3", expect.any(Function));
    expect(sqlMock).toHaveBeenCalledOnce();
  });
});
