import postgres, { type TransactionSql } from "postgres";
import { logger } from "@spctre/platform/logging";
import { incrementCounter, registerDbPoolMetrics } from "@spctre/platform/metrics";
import { assertTenantId, getBoundTenantId, runWithTenantContext } from "@/lib/tenant-context";
import { SESSION_GUARD_COOKIE, verifySessionGuardToken } from "@/lib/session-guard";

type SqlClient = ReturnType<typeof postgres>;

interface PostgresInternalCounts {
  connecting: number;
  idle: number;
  active: number;
  waiting: number;
}

type InstrumentedSqlClient = SqlClient & { counts: PostgresInternalCounts };

export type { TransactionSql as TxClient } from "postgres";

declare global {
  // Reuse the postgres pool across Next.js module reloads in dev.
  var __spctreSqlClient:
    | {
        url: string;
        ownerUrl: string | null;
        poolSize: number;
        client: SqlClient;
        rawClient: SqlClient;
      }
    | undefined;
}

async function resolveTenantContext(): Promise<string | null> {
  const explicit = getBoundTenantId();
  if (explicit) return explicit;

  let bearerRequest = false;
  try {
    const { cookies, headers } = await import("next/headers");
    const requestHeaders = await headers();
    bearerRequest = /^Bearer\s+/i.test(requestHeaders.get("authorization") ?? "");
    if (!bearerRequest) {
      const cookieStore = await cookies();
      const sessionId = cookieStore.get("spctre_session_id")?.value;
      const guardToken = cookieStore.get(SESSION_GUARD_COOKIE)?.value;
      if (sessionId && guardToken) {
        const claims = await verifySessionGuardToken(guardToken, sessionId);
        if (claims?.tid) return claims.tid;
      }
    }
  } catch {
    // Not running in a request context.
  }

  if (bearerRequest) {
    incrementCounter("spctre.db.unbound_tenant_context", 1, {
      environment: process.env.NODE_ENV ?? "development",
      auth_mode: "bearer",
    });
    throw new Error(
      "Bearer-token database work requires an explicit tenant context. " +
        "Wrap tenant-scoped work in runWithTenantContext."
    );
  }

  const explicitDefault = process.env.SPCTRE_DEFAULT_TENANT_ID?.trim();
  if (explicitDefault && process.env.SPCTRE_SINGLE_TENANT_MODE === "true") {
    assertTenantId(explicitDefault);
    return explicitDefault;
  }

  incrementCounter("spctre.db.unbound_tenant_context", 1, {
    environment: process.env.NODE_ENV ?? "development",
    default_tenant_configured: String(Boolean(explicitDefault)),
  });
  throw new Error(
    "No tenant context is bound. Wrap tenant-scoped database work in runWithTenantContext."
  );
}

// Connection-class failures (Cloud SQL maintenance/failover, dropped pooled
// connections) that a fresh connection can survive. Query-level errors
// (constraint violations, bad SQL) are never retried.
const TRANSIENT_DB_ERROR_CODES = new Set([
  // SQLSTATE class 08 (connection exceptions) + shutdown states.
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "57P01", "57P02", "57P03",
  // postgres.js connection lifecycle errors.
  "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT",
  // Socket-level errors surfaced by the driver.
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
]);

function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_DB_ERROR_CODES.has(code);
}

function isReadStatement(strings: TemplateStringsArray): boolean {
  return /^\s*select\b/i.test(strings[0] ?? "");
}

const DB_READ_RETRY_ATTEMPTS = 3;

// Retries reads on transient connection errors; writes run once here because
// their retry safety lives at the caller (idempotency-keyed ingest paths).
async function runWithTransientRetry<T>(readOnly: boolean, run: () => Promise<T>): Promise<T> {
  const attempts = readOnly ? DB_READ_RETRY_ATTEMPTS : 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt + Math.random() * 100));
    }
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === attempts) throw err;
      logger.warn("[spctre-db] transient connection error; retrying read", {
        attempt,
        code: (err as { code?: string }).code,
      });
    }
  }
  throw lastErr;
}

// For pre-authentication reads that must use the owner connection before a
// tenant can be derived (for example, bearer-token hash lookups).
export function runWithTransientReadRetry<T>(run: () => Promise<T>): Promise<T> {
  return runWithTransientRetry(true, run);
}

function createTenantAwareClient(client: SqlClient): SqlClient {
  const raw = client as any;

  async function setTenant(tx: TransactionSql, tenantId: string) {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
  }

  const tenantSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const tenantId = await resolveTenantContext();
    const readOnly = isReadStatement(strings);
    if (!tenantId) return runWithTransientRetry(readOnly, () => raw(strings, ...values));

    return runWithTransientRetry(readOnly, () =>
      raw.begin(async (tx: TransactionSql) => {
        await setTenant(tx, tenantId);
        return (tx as any)(strings, ...values);
      })
    );
  }) as unknown as SqlClient;

  return new Proxy(tenantSql, {
    get(target, prop, receiver) {
      if (prop === "begin") {
        return async (callback: (tx: TransactionSql) => Promise<unknown>) => {
          const tenantId = await resolveTenantContext();
          if (!tenantId) return raw.begin(callback);

          return raw.begin(async (tx: TransactionSql) => {
            await setTenant(tx, tenantId);
            return callback(tx);
          });
        };
      }

      if (prop === "unsafe") {
        return async (query: string, ...args: unknown[]) => {
          const tenantId = await resolveTenantContext();
          if (!tenantId) return raw.unsafe(query, ...args);

          return raw.begin(async (tx: TransactionSql) => {
            await setTenant(tx, tenantId);
            return (tx as any).unsafe(query, ...args);
          });
        };
      }

      const value = Reflect.get(client, prop, receiver);
      return typeof value === "function" ? value.bind(client) : value ?? Reflect.get(target, prop, receiver);
    },
  });
}

function createClient() {
  if (!process.env.DATABASE_URL) return null;
  const poolSize = Number.parseInt(process.env.DATABASE_POOL_SIZE ?? "5", 10);
  const max = Number.isFinite(poolSize) && poolSize > 0 ? poolSize : 5;
  const ownerUrl = process.env.DATABASE_OWNER_URL?.trim() || null;

  if (
    globalThis.__spctreSqlClient?.url === process.env.DATABASE_URL &&
    globalThis.__spctreSqlClient.ownerUrl === ownerUrl &&
    globalThis.__spctreSqlClient.poolSize === max
  ) {
    return globalThis.__spctreSqlClient.client;
  }

  const rawClient = postgres(process.env.DATABASE_URL, {
    max,
    idle_timeout: 20,
    max_lifetime: 60 * 30
  });
  const ownerClient = ownerUrl && ownerUrl !== process.env.DATABASE_URL
    ? postgres(ownerUrl, {
        max: Math.min(max, 2),
        idle_timeout: 20,
        max_lifetime: 60 * 30
      })
    : rawClient;
  const client = createTenantAwareClient(rawClient);

  globalThis.__spctreSqlClient = {
    url: process.env.DATABASE_URL,
    ownerUrl,
    poolSize: max,
    client,
    rawClient: ownerClient
  };

  const instrumented = rawClient as unknown as InstrumentedSqlClient;
  if (instrumented.counts !== undefined) {
    registerDbPoolMetrics("spctre-web", () => {
      return { active: instrumented.counts.active, idle: instrumented.counts.idle, waiting: instrumented.counts.waiting, max };
    });
  }

  return client;
}

export const sql = createClient() as SqlClient;
export const rawSql = (globalThis.__spctreSqlClient?.rawClient ?? sql) as SqlClient;

/**
 * Executes a callback inside a transaction with the RLS tenant context set.
 *
 * Uses local `set_config` which is scoped to the current transaction only,
 * so there is no risk of leaking tenant context across pooled
 * connections. If the database connection uses the `spctre_app` role, RLS
 * policies will restrict all queries to rows matching this tenant.
 */
export async function withTenant<T>(
  tenantId: string | null | undefined,
  fn: (tx: TransactionSql) => Promise<T>
): Promise<T> {
  assertTenantId(tenantId);
  if (!sql) throw new Error("Database not configured.");
  return runWithTenantContext(tenantId, () => sql.begin(fn) as Promise<T>);
}

export { runWithTenantContext } from "@/lib/tenant-context";
