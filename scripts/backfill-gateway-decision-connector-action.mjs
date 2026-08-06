/**
 * One-off backfill for gateway_decision.connector / action.
 *
 * Migration 008 added those columns. Decision-time writes populate them going
 * forward, but historical decisions carry NULL and can only be recovered from
 * the runtime evidence event that followed them. That recovery is a full scan
 * of runtime_evidence_event, so it cannot live in the migration: each
 * migration file runs in one transaction, and the scan would hold the ADD
 * COLUMN's ACCESS EXCLUSIVE lock on gateway_decision — stalling every gateway
 * decide write until it finished.
 *
 * Decisions with no evidence event stay NULL. Nothing can reconstruct them
 * retrospectively, and readers already treat both columns as optional.
 *
 * Run as the migration/owner role, NOT the RLS-constrained spctre_app role —
 * the tenant_isolation policy on gateway_decision filters on
 * app.current_tenant_id, which is unset here, so the app role would match zero
 * rows and report a clean no-op. Use the same DATABASE_URL as `pnpm migrate`.
 *
 * Safe to re-run: it only considers rows that are still NULL, so a partial or
 * interrupted run resumes cleanly.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/backfill-gateway-decision-connector-action.mjs [--dry-run] [--batch=N]
 */

import postgres from "postgres";

const dryRun = process.argv.includes("--dry-run");
const batchArg = process.argv.find((arg) => arg.startsWith("--batch="));
const batchSize = batchArg ? Number.parseInt(batchArg.split("=")[1], 10) : 500;

if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error(`Invalid --batch value: ${batchArg}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

async function main() {
  const [{ count: pending }] = await sql`
    SELECT count(*)::int AS count
    FROM gateway_decision
    WHERE connector IS NULL OR action IS NULL
  `;
  console.log(`${pending} decision(s) missing connector/action.`);
  if (pending === 0) {
    console.log("Nothing to backfill.");
    return { updated: 0, unmatched: 0 };
  }
  if (dryRun) console.log("Dry run — no writes will be made.\n");

  let updated = 0;
  let unmatched = 0;
  let lastId = "00000000-0000-0000-0000-000000000000";

  for (;;) {
    // Keyset pagination by primary key. Candidates are selected separately
    // from the update so the cursor advances past rows that have no evidence
    // event: those stay NULL forever, and an offset or a WHERE-still-NULL
    // cursor would re-select them on every pass and never terminate.
    const candidates = await sql`
      SELECT id
      FROM gateway_decision
      WHERE (connector IS NULL OR action IS NULL)
        AND id > ${lastId}
      ORDER BY id
      LIMIT ${batchSize}
    `;
    if (candidates.length === 0) break;

    const ids = candidates.map((row) => row.id);
    lastId = ids[ids.length - 1];

    if (dryRun) {
      const [{ count: matchable }] = await sql`
        SELECT count(*)::int AS count
        FROM gateway_decision gd
        WHERE gd.id = ANY(${ids}::uuid[])
          AND EXISTS (
            SELECT 1
            FROM runtime_evidence_event ree
            WHERE ree.tenant_id = gd.tenant_id
              AND ree.workspace_id = gd.workspace_id
              AND ree.decision_id = gd.decision_id
              AND ree.artifact_hash = gd.artifact_hash
          )
      `;
      console.log(`  batch of ${ids.length}: ${matchable} recoverable from evidence`);
      updated += matchable;
      unmatched += ids.length - matchable;
      continue;
    }

    // The evidence lookup runs against a `batch` CTE rather than laterally
    // against the UPDATE target: Postgres rejects LATERAL references to the
    // table being updated ("invalid reference to FROM-clause entry"). Scoping
    // the CTE to this batch's ids also keeps the evidence scan off the whole
    // partitioned table.
    //
    // COALESCE rather than straight assignment: a row may have picked up one
    // column from a decision-time write while the other is still NULL.
    const rows = await sql`
      WITH batch AS (
        SELECT id, tenant_id, workspace_id, decision_id, artifact_hash
        FROM gateway_decision
        WHERE id = ANY(${ids}::uuid[])
      ),
      recovered AS (
        SELECT batch.id, ev.connector, ev.action
        FROM batch
        JOIN LATERAL (
          SELECT ree.connector, ree.action
          FROM runtime_evidence_event ree
          WHERE ree.tenant_id = batch.tenant_id
            AND ree.workspace_id = batch.workspace_id
            AND ree.decision_id = batch.decision_id
            AND ree.artifact_hash = batch.artifact_hash
          ORDER BY ree.created_at DESC
          LIMIT 1
        ) ev ON true
      )
      UPDATE gateway_decision gd
      SET connector = COALESCE(gd.connector, recovered.connector),
          action = COALESCE(gd.action, recovered.action)
      FROM recovered
      WHERE gd.id = recovered.id
      RETURNING gd.id
    `;
    updated += rows.length;
    unmatched += ids.length - rows.length;
  }

  return { updated, unmatched };
}

try {
  const { updated, unmatched } = await main();
  console.log(
    `\n${dryRun ? "Would recover" : "Recovered"} ${updated} decision(s) from evidence; ` +
      `${unmatched} had no evidence event and remain NULL.`,
  );
} finally {
  await sql.end();
}
