import { beforeEach, describe, expect, it, vi } from "vitest";

// The repository contract is exercised without a live database; database-level
// expiry cleanup is covered by the worker integration test.
const sqlSpy = vi.fn(async () => [] as unknown[]);

vi.mock("@/lib/db", () => ({
  sql: sqlSpy,
  rawSql: vi.fn((strings: any) => strings),
}));

vi.mock("@spctre/platform/metrics", () => ({
  registerDbPoolMetrics: vi.fn(),
}));

process.env.DATABASE_URL = "postgres://spctre.test/app";

const {
  saveSamlAuthnRequestId,
  claimSamlAuthnRequestValue,
  releaseSamlAuthnRequestLease,
  finalizeSamlAuthnRequestLease,
} = await import("../lib/repositories/auth/saml-request-cache");

describe("SAML AuthnRequest cache repository", () => {
  beforeEach(() => {
    sqlSpy.mockReset();
    sqlSpy.mockResolvedValue([]);
  });

  describe("saveSamlAuthnRequestId", () => {
    it("resolves when a row is inserted", async () => {
      sqlSpy.mockResolvedValueOnce([{ request_id: "req-1" }]);
      await expect(saveSamlAuthnRequestId({
        tenantId: "11111111-1111-1111-1111-111111111111",
        requestId: "req-1",
        value: "2026-07-15T00:00:00Z",
        ttlSeconds: 3600,
      })).resolves.toBeUndefined();
      expect(sqlSpy).toHaveBeenCalledOnce();
    });

    it("rejects on conflict (no RETURNING row) rather than overwriting", async () => {
      sqlSpy.mockResolvedValueOnce([]);
      await expect(saveSamlAuthnRequestId({
        tenantId: "11111111-1111-1111-1111-111111111111",
        requestId: "req-dup",
        value: "v",
        ttlSeconds: 3600,
      })).rejects.toThrow("Failed to persist SAML AuthnRequest ID");
    });

    it("rejects without issuing SQL when requestId is empty", async () => {
      await expect(saveSamlAuthnRequestId({
        tenantId: "t",
        requestId: "",
        value: "v",
        ttlSeconds: 3600,
      })).rejects.toThrow("Failed to persist SAML AuthnRequest ID");
      expect(sqlSpy).not.toHaveBeenCalled();
    });
  });

  describe("claimSamlAuthnRequestValue", () => {
    const claim = { tenantId: "11111111-1111-1111-1111-111111111111", requestId: "req-1", leaseId: "lease-1", leaseSeconds: 60 };

    it("atomically leases and returns the stored value when present and unexpired", async () => {
      sqlSpy.mockResolvedValueOnce([{ value: "2026-07-15T00:00:00Z" }]);
      const value = await claimSamlAuthnRequestValue(claim);
      expect(value).toBe("2026-07-15T00:00:00Z");
      expect(sqlSpy).toHaveBeenCalledOnce();
    });

    it("returns null when no matching/unexpired row exists", async () => {
      sqlSpy.mockResolvedValueOnce([]);
      expect(await claimSamlAuthnRequestValue({ ...claim, requestId: "missing" })).toBeNull();
    });

    it("no-ops without SQL for an empty id", async () => {
      expect(await claimSamlAuthnRequestValue({ ...claim, requestId: "" })).toBeNull();
      expect(sqlSpy).not.toHaveBeenCalled();
    });

    it("no-ops without SQL when tenantId is empty", async () => {
      expect(await claimSamlAuthnRequestValue({ ...claim, tenantId: "" })).toBeNull();
      expect(sqlSpy).not.toHaveBeenCalled();
    });
  });

  it("releases only its own unconsumed lease", async () => {
    await releaseSamlAuthnRequestLease({ tenantId: "tenant-a", requestId: "req-1", leaseId: "lease-1" });
    expect(sqlSpy).toHaveBeenCalledOnce();
  });

  it("marks only its own lease as consumed after validation succeeds", async () => {
    sqlSpy.mockResolvedValueOnce([{ request_id: "req-1" }]);
    await expect(finalizeSamlAuthnRequestLease({ tenantId: "tenant-a", requestId: "req-1", leaseId: "lease-1" })).resolves.toBe(true);
    expect(sqlSpy).toHaveBeenCalledOnce();
  });
});
