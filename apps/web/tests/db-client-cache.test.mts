import { beforeEach, describe, expect, it, vi } from "vitest";

// A build runs more than one copy of lib/db. The app's copy lives in the
// compiled server chunks; a commercial slot is a standalone bundle that inlines
// its own. Both copies share `globalThis`, so whatever one caches there is
// handed to the other.
//
// A connection pool is copy-agnostic and must be shared. A tenant-aware client
// is not: it closes over the `resolveTenantContext` of the copy that built it,
// and inside a slot bundle that function reads `next/headers` resolved from
// node_modules rather than the instance compiled into the server chunks, where
// `cookies()` throws. Caching the client gave the whole process the resolver of
// whichever copy evaluated first — so a slot imported before the app's own
// chunk left every cookie-authenticated request unable to find its tenant.
//
// vi.resetModules() models the second copy: a fresh module registry over the
// same globalThis.
const { postgresFactory } = vi.hoisted(() => {
  const postgresFactory = vi.fn(() =>
    Object.assign(
      vi.fn(async () => []),
      {
        begin: vi.fn(),
        counts: { active: 0, idle: 0, waiting: 0, connecting: 0 },
        unsafe: vi.fn(),
      },
    ),
  );
  return { postgresFactory };
});

vi.mock("postgres", () => ({ default: postgresFactory }));
vi.mock("@spctre/platform/metrics", () => ({
  incrementCounter: vi.fn(),
  registerDbPoolMetrics: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => new Map()),
  headers: vi.fn(async () => new Headers()),
}));

process.env.DATABASE_URL = "postgres://spctre.test/app";

describe("the global database cache", () => {
  beforeEach(() => {
    delete globalThis.__spctreSqlPools;
    postgresFactory.mockClear();
    vi.resetModules();
  });

  it("shares the pool between module copies but not the tenant-aware client", async () => {
    const first = await import("../lib/db");
    vi.resetModules();
    const second = await import("../lib/db");

    // One pool: the second copy reused what the first cached.
    expect(postgresFactory).toHaveBeenCalledTimes(1);

    // Two clients: each copy resolves tenants with its own resolveTenantContext.
    expect(first.sql).not.toBe(second.sql);
  });

  it("caches pools rather than a client", async () => {
    const db = await import("../lib/db");

    expect(globalThis.__spctreSqlPools).toBeDefined();
    // Nothing a later copy reads back may be this copy's tenant-aware client.
    expect(Object.values(globalThis.__spctreSqlPools ?? {})).not.toContain(db.sql);
  });
});
