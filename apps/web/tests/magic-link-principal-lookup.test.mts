import { beforeEach, describe, expect, it, vi } from "vitest";

const { ownerSqlMock, tenantSqlMock } = vi.hoisted(() => ({
  ownerSqlMock: vi.fn(),
  tenantSqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: tenantSqlMock,
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));

const { createSessionRow, getPrincipalForLogin } = await import("../lib/repositories/auth/session");

describe("magic-link principal lookup", () => {
  beforeEach(() => {
    ownerSqlMock.mockReset();
    tenantSqlMock.mockReset();
  });

  it("uses the supplied bootstrap connection before a tenant session exists", async () => {
    ownerSqlMock.mockResolvedValueOnce([
      {
        id: "principal-1",
        tenant_id: "tenant-1",
        subject: "buyer@example.com",
        require_mfa: false,
        disabled_at: null,
      },
    ]);

    await expect(getPrincipalForLogin("principal-1", ownerSqlMock as never)).resolves.toMatchObject({
      id: "principal-1",
      tenant_id: "tenant-1",
    });

    expect(ownerSqlMock).toHaveBeenCalledOnce();
    expect(tenantSqlMock).not.toHaveBeenCalled();
  });

  it("creates the bootstrap session through the supplied owner connection", async () => {
    ownerSqlMock
      .mockResolvedValueOnce([{ id: "principal-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);

    await expect(createSessionRow({
      principalId: "principal-1",
      tenantId: "tenant-1",
      expiresAt: "2026-07-31T00:00:00.000Z",
      authMethod: "SESSION",
    }, ownerSqlMock as never)).resolves.toBe("session-1");

    expect(ownerSqlMock).toHaveBeenCalledTimes(2);
    expect(tenantSqlMock).not.toHaveBeenCalled();
  });
});
