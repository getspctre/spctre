import { beforeEach, describe, expect, it, vi } from "vitest";

const { ownerSqlMock, tenantSqlMock } = vi.hoisted(() => ({
  ownerSqlMock: vi.fn(),
  tenantSqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: tenantSqlMock,
}));

const { getPrincipalForLogin } = await import("../lib/repositories/auth/session");

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
});
