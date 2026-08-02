import { beforeEach, describe, expect, it, vi } from "vitest";

const { rawSqlMock, sqlMock } = vi.hoisted(() => ({
  rawSqlMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  rawSql: rawSqlMock,
  sql: sqlMock,
}));

const { consumeWebauthnChallenge, saveWebauthnChallenge } = await import("../lib/repositories/auth/webauthn-challenge");

describe("webauthn challenge repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the pre-session owner connection to save a usernameless login challenge", async () => {
    rawSqlMock.mockResolvedValue([{ id: "challenge-1" }]);

    await expect(saveWebauthnChallenge({
      purpose: "AUTHENTICATION",
      challenge: "challenge-value",
      ttlSeconds: 300,
    })).resolves.toBe("challenge-1");

    expect(rawSqlMock).toHaveBeenCalledTimes(1);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("uses the pre-session owner connection to consume a login challenge", async () => {
    rawSqlMock.mockResolvedValue([{
      challenge: "challenge-value",
      principal_id: null,
      tenant_id: null,
    }]);

    await expect(consumeWebauthnChallenge({
      id: "challenge-1",
      purpose: "AUTHENTICATION",
    })).resolves.toEqual({
      challenge: "challenge-value",
      principalId: null,
      tenantId: null,
    });

    expect(rawSqlMock).toHaveBeenCalledTimes(1);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
