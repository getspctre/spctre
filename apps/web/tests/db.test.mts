import { beforeEach, describe, expect, it, vi } from "vitest";

const { beginMock, rawSqlMock, txMock } = vi.hoisted(() => {
  const rawSqlMock = vi.fn(async () => [{ direct: true }]);
  const txMock = Object.assign(vi.fn(async () => [{ set_config: "tenant-id" }]), {
    unsafe: vi.fn(async () => [{ unsafe: true }]),
  });
  const beginMock = vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
  return { beginMock, rawSqlMock, txMock };
});

vi.mock("postgres", () => ({
  default: vi.fn(() => Object.assign(rawSqlMock, {
    begin: beginMock,
    counts: { active: 0, idle: 0, waiting: 0, connecting: 0 },
    unsafe: vi.fn(async () => [{ unsafe: true }]),
  })),
}));

vi.mock("@spctre/platform/metrics", () => ({
  incrementCounter: vi.fn(),
  registerDbPoolMetrics: vi.fn(),
}));

process.env.DATABASE_URL = "postgres://spctre.test/app";

const { runWithTenantContext, sql, withTenant } = await import("../lib/db");

describe("database tenant context", () => {
  beforeEach(() => {
    beginMock.mockClear();
    rawSqlMock.mockClear();
    txMock.mockClear();
    txMock.unsafe.mockClear();
  });

  it("rejects missing tenant IDs before opening a transaction", async () => {
    await expect(withTenant(null, async () => "ok")).rejects.toThrow("Tenant ID is required.");
    await expect(withTenant(undefined, async () => "ok")).rejects.toThrow("Tenant ID is required.");
    await expect(withTenant("   ", async () => "ok")).rejects.toThrow("Tenant ID is required.");
    expect(beginMock).not.toHaveBeenCalled();
  });

  it("rejects malicious-looking tenant IDs before opening a transaction", async () => {
    await expect(
      withTenant("123e4567-e89b-12d3-a456-426614174000'; SELECT pg_sleep(10); --", async () => "ok")
    ).rejects.toThrow("Invalid tenant ID.");

    expect(beginMock).not.toHaveBeenCalled();
  });

  // This is a deliberate security-boundary interaction assertion: parameter
  // binding is the contract that prevents a tenant-context SQL injection.
  it("sets tenant context with a parameterized statement", async () => {
    const tenantId = "123e4567-e89b-12d3-a456-426614174000";

    await expect(withTenant(tenantId, async () => "ok")).resolves.toBe("ok");

    expect(beginMock).toHaveBeenCalledTimes(1);
    expect(txMock).toHaveBeenCalledTimes(1);
    const [strings, boundTenantId] = txMock.mock.calls[0]!;
    expect(Array.from(strings)).toEqual(["SELECT set_config('app.current_tenant_id', ", ", true)"]);
    expect(boundTenantId).toBe(tenantId);
  });

  it("wraps direct queries in the active tenant context", async () => {
    const tenantId = "123e4567-e89b-12d3-a456-426614174000";

    await runWithTenantContext(tenantId, async () => {
      await sql!`SELECT 1`;
    });

    expect(beginMock).toHaveBeenCalledTimes(1);
    expect(txMock).toHaveBeenCalledTimes(2);
    const [setConfigStrings, boundTenantId] = txMock.mock.calls[0]!;
    expect(Array.from(setConfigStrings)).toEqual(["SELECT set_config('app.current_tenant_id', ", ", true)"]);
    expect(boundTenantId).toBe(tenantId);
    const [queryStrings] = txMock.mock.calls[1]!;
    expect(Array.from(queryStrings)).toEqual(["SELECT 1"]);
    expect(rawSqlMock).not.toHaveBeenCalled();
  });

  it("fails closed when a tenant-scoped query has no bound context", async () => {
    await expect(sql!`SELECT 1`).rejects.toThrow("No tenant context is bound.");
    expect(beginMock).not.toHaveBeenCalled();
  });
});
