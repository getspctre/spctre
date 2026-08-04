import { describe, expect, it, vi, beforeEach } from "vitest";

// ── SQL mock for service-tokens tests ─────────────────────────────────────────

// Queue: each entry is the result for the next sql call.
const sqlResultQueue: unknown[][] = [];

const txFn = (..._args: unknown[]) => {
  if (sqlResultQueue.length > 0) return Promise.resolve(sqlResultQueue.shift()!);
  return Promise.resolve([{ id: "new-token-id" }]);
};

const sqlMock = Object.assign(
  (..._args: unknown[]): Promise<unknown[]> => {
    if (sqlResultQueue.length > 0) return Promise.resolve(sqlResultQueue.shift()!);
    return Promise.resolve([]);
  },
  { begin: vi.fn((fn: (tx: typeof txFn) => Promise<unknown>) => fn(txFn)) },
);

vi.mock("@/lib/db", () => ({ sql: sqlMock, rawSql: sqlMock }));

const { rotateRefreshToken } = await import("../lib/service-tokens");

// ── Tests for rotateRefreshToken (R3 server-side token observability) ─────────

describe("Token lifecycle – rotateRefreshToken server-side (R3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlResultQueue.length = 0;
  });

  it("returns 401 for a revoked refresh token and emits structured telemetry", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    sqlResultQueue.push([
      {
        id: "rt-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        principal_id: "principal-1",
        access_token_id: "at-1",
        expires_at: new Date(Date.now() + 1e8).toISOString(),
        revoked_at: new Date().toISOString(),
        rotated_at: null,
      },
    ]);

    const result = await rotateRefreshToken("raw-revoked-token");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/revoked/i);
    }

    const telemetry = consoleSpy.mock.calls
      .map(([msg]) => {
        try {
          return JSON.parse(msg as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((obj) => obj?.event === "token.revoked_reuse_attempt");

    expect(telemetry).toBeDefined();
    expect(telemetry?.token_id).toBe("rt-1");
    expect(telemetry?.tenant_id).toBe("tenant-1");
    expect(typeof telemetry?.ts).toBe("string");
    consoleSpy.mockRestore();
  });

  it("returns 401 for an already-rotated token and emits structured telemetry", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    sqlResultQueue.push([
      {
        id: "rt-2",
        tenant_id: "tenant-2",
        workspace_id: "ws-2",
        principal_id: "principal-2",
        access_token_id: "at-2",
        expires_at: new Date(Date.now() + 1e8).toISOString(),
        revoked_at: null,
        rotated_at: new Date().toISOString(),
      },
    ]);

    const result = await rotateRefreshToken("raw-rotated-token");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);

    const telemetry = consoleSpy.mock.calls
      .map(([msg]) => {
        try {
          return JSON.parse(msg as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((obj) => obj?.event === "token.rotated_reuse_attempt");

    expect(telemetry?.token_id).toBe("rt-2");
    expect(typeof telemetry?.rotated_at).toBe("string");
    consoleSpy.mockRestore();
  });

  it("returns 401 for an expired refresh token and emits structured telemetry", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    sqlResultQueue.push([
      {
        id: "rt-3",
        tenant_id: "tenant-3",
        workspace_id: "ws-3",
        principal_id: "principal-3",
        access_token_id: "at-3",
        expires_at: new Date(Date.now() - 1000).toISOString(), // expired
        revoked_at: null,
        rotated_at: null,
      },
    ]);

    const result = await rotateRefreshToken("raw-expired-token");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/expired/i);
    }

    const telemetry = consoleSpy.mock.calls
      .map(([msg]) => {
        try {
          return JSON.parse(msg as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((obj) => obj?.event === "token.expired_refresh_attempt");

    expect(telemetry?.token_id).toBe("rt-3");
    expect(typeof telemetry?.expired_at).toBe("string");
    consoleSpy.mockRestore();
  });

  it("returns 401 when refresh token is not found (no telemetry expected)", async () => {
    sqlResultQueue.push([]); // empty result — token not in DB

    const result = await rotateRefreshToken("raw-unknown-token");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/not found/i);
    }
  });

  it("revoked token error includes 'revoked' in the message (clear error contract)", async () => {
    sqlResultQueue.push([
      {
        id: "rt-5",
        tenant_id: "t-5",
        workspace_id: "w-5",
        principal_id: "p-5",
        access_token_id: "at-5",
        expires_at: new Date(Date.now() + 1e8).toISOString(),
        revoked_at: new Date().toISOString(),
        rotated_at: null,
      },
    ]);

    const result = await rotateRefreshToken("raw-revoked-2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("revoked");
  });

  it("rotated token error includes 'rotated' in the message (clear error contract)", async () => {
    sqlResultQueue.push([
      {
        id: "rt-6",
        tenant_id: "t-6",
        workspace_id: "w-6",
        principal_id: "p-6",
        access_token_id: "at-6",
        expires_at: new Date(Date.now() + 1e8).toISOString(),
        revoked_at: null,
        rotated_at: new Date().toISOString(),
      },
    ]);

    const result = await rotateRefreshToken("raw-rotated-2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("rotated");
  });
});

// ── Deleted: SLO constant contract tests (R2/R3 joint) ─────────────────────────
// These tested hardcoded numbers against other hardcoded numbers — not production behavior.
// SLO values are defined in packages/mcp-server/src/token.ts and tested there.

// ── Deleted: AccessTokenManager retry and backoff contract (R3) ───────────────
// These constructed fake event objects without calling production code.
// Replaced by packages/mcp-server/tests/token.test.ts which tests the real manager.
