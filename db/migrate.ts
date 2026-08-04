/**
 * Idempotent schema runner.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node --loader ts-node/esm db/migrate.ts
 *   pnpm migrate
 *
 * Applies the public launch baseline and every subsequent migration in filename
 * order. Tracks applied files in schema_migrations so re-runs are safe.
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const LAUNCH_SCHEMA = "001_launch_schema.sql";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const allFiles = await readdir(MIGRATIONS_DIR);
    const migrationFiles = allFiles.filter((f) => f.endsWith(".sql")).sort();

    if (!migrationFiles.includes(LAUNCH_SCHEMA)) {
      throw new Error(`Missing required public launch schema: ${LAUNCH_SCHEMA}`);
    }

    const appliedRows = await sql<{ filename: string }[]>`
      SELECT filename FROM schema_migrations ORDER BY filename
    `;
    const knownFiles = new Set(migrationFiles);
    const legacyFiles = appliedRows
      .map((row) => row.filename)
      .filter((filename) => !knownFiles.has(filename));
    if (legacyFiles.length > 0) {
      throw new Error(
        "Legacy migration state detected. The public launch schema is a clean-install " +
          "baseline; rebuild this database from a backup or restore it before running pnpm migrate. " +
          `Unexpected entries: ${legacyFiles.join(", ")}`,
      );
    }
    const applied = new Set(appliedRows.map((r) => r.filename));

    const pending = migrationFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log(`Applying ${pending.length} migration(s)...`);

    const appRolePassword = process.env.SPCTRE_APP_DB_PASSWORD || "spctre_app_dev";
    const credentialEncryptionKey = process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY || "";

    for (const filename of pending) {
      const filepath = join(MIGRATIONS_DIR, filename);
      const sqlText = await readFile(filepath, "utf-8");

      console.log(`  → ${filename}`);
      await sql.begin(async (tx) => {
        // Secrets are passed as transaction-local GUCs via bind parameters so
        // they never appear in SQL statement text (logs, pg_stat_statements).
        // Migrations read them with current_setting('spctre.*').
        await tx`
          SELECT set_config('spctre.app_db_password', ${appRolePassword}, true),
                 set_config('spctre.credential_encryption_key', ${credentialEncryptionKey}, true)
        `;
        await tx.unsafe(sqlText);
        await tx`
          INSERT INTO public.schema_migrations (filename) VALUES (${filename})
        `;
      });
    }

    console.log("Done.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
