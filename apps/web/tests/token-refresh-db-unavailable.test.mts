import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/db", () => ({ sql: null }));

const { rotateRefreshToken } = await import("../lib/service-tokens");

describe("Token refresh — DB unavailable", () => {
  it("returns 503 when the database is not configured", async () => {
    const result = await rotateRefreshToken("any-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.error).toMatch(/database not configured/i);
    }
  });
});
