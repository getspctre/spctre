import { rawSql } from "@/lib/db";

export const dynamic = "force-dynamic";

const REQUIRED_ENV_VARS = ["DATABASE_URL", "SPCTRE_SESSION_GUARD_SECRET"] as const;

const EXPECTED_MIGRATION_COUNT = 1;

async function handleGetApiReady() {
  const checks: Record<string, { ok: boolean; reason?: string }> = {};

  // 1. Required env vars
  const missingEnv = REQUIRED_ENV_VARS.filter((v) => !process.env[v]?.trim());
  checks.env = missingEnv.length === 0
    ? { ok: true }
    : { ok: false, reason: `Missing: ${missingEnv.join(", ")}` };

  // 2. Database connectivity
  if (!rawSql) {
    checks.db = { ok: false, reason: "DATABASE_URL not configured" };
  } else {
    try {
      await rawSql`SELECT 1`;
      checks.db = { ok: true };
    } catch (err) {
      console.error("[ready] database check failed", err);
      checks.db = { ok: false, reason: "Database unavailable" };
    }
  }

  // 3. Migration state — schema_migrations table must exist and be fully applied
  if (checks.db.ok && rawSql) {
    try {
      const rows = await rawSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM schema_migrations
      `;
      const applied = Number.parseInt(rows[0]?.count ?? "0", 10);
      checks.migrations = applied >= EXPECTED_MIGRATION_COUNT
        ? { ok: true }
        : {
            ok: false,
            reason: `${applied}/${EXPECTED_MIGRATION_COUNT} migrations applied — run pnpm migrate`,
          };
    } catch {
      checks.migrations = {
        ok: false,
        reason: "schema_migrations table not found — run pnpm migrate",
      };
    }
  } else {
    checks.migrations = { ok: false, reason: "Skipped (db unavailable)" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return Response.json(
    { ok: allOk, checks },
    { status: allOk ? 200 : 503 }
  );
}

export { handleGetApiReady as GET };
