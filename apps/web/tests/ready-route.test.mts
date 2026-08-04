import { beforeEach, describe, expect, it, vi } from "vitest";

const rawSqlMock = vi.fn(async () => [{ count: "1" }]);

vi.mock("@/lib/db", () => ({ rawSql: rawSqlMock }));

const { GET } = await import("../app/api/ready/route");

describe("GET /api/ready", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_SESSION_GUARD_SECRET = "test-session-guard";
    rawSqlMock.mockClear();
  });

  it("uses the unscoped database client for health and migration checks", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      checks: { env: { ok: true }, db: { ok: true }, migrations: { ok: true } },
    });
    expect(rawSqlMock).toHaveBeenCalledTimes(2);
  });
});
