import { beforeEach, describe, expect, it, vi } from "vitest";

// The limiter guards magic-link issuance, recovery-code verification and MFA
// verification, and is backed by the same database it protects. If it allowed
// on error, stressing the database would also switch the limiter off.
const rawSqlSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  get rawSql() {
    return rawSqlSpy;
  },
}));

const logSecurityEventSpy = vi.fn();
vi.mock("@/lib/security-logger", () => ({ logSecurityEvent: logSecurityEventSpy }));

const { checkAuthRateLimit } = await import("../lib/auth-rate-limit");

const params = { key: "magic_link:someone@example.com", limit: 3, windowSeconds: 900 };

describe("checkAuthRateLimit", () => {
  beforeEach(() => {
    rawSqlSpy.mockReset();
    logSecurityEventSpy.mockReset();
  });

  it("denies when the limiter query throws", async () => {
    rawSqlSpy.mockRejectedValue(new Error("connection terminated"));

    const result = await checkAuthRateLimit(params);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(logSecurityEventSpy).toHaveBeenCalledWith(
      "rate_limited",
      expect.objectContaining({ detail: expect.stringContaining("connection terminated") }),
    );
  });

  it("denies when the upsert returns no row", async () => {
    rawSqlSpy.mockResolvedValue([]);

    const result = await checkAuthRateLimit(params);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(logSecurityEventSpy).toHaveBeenCalledWith("rate_limited", expect.anything());
  });

  it("allows a request inside the window", async () => {
    rawSqlSpy.mockResolvedValue([{ count: 1, window_start: new Date() }]);

    const result = await checkAuthRateLimit(params);

    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
    expect(logSecurityEventSpy).not.toHaveBeenCalled();
  });

  it("denies once the window count exceeds the limit, with a Retry-After", async () => {
    rawSqlSpy.mockResolvedValue([{ count: 4, window_start: new Date() }]);

    const result = await checkAuthRateLimit(params);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});
