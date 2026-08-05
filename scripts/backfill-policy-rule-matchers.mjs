/**
 * One-off backfill for policy_rule.semantic_checks / parameter_constraints.
 *
 * Migration 007 added those columns, but their values live only inside
 * policy_revision.source_document and need the TypeScript AGT parser to
 * recover — which SQL cannot do, so the migration could not populate them.
 *
 * Until a revision is backfilled, its rules carry NULL matchers. Any reader
 * trusting the columns would evaluate such a rule as a bare connector/action
 * match, ignoring its thresholds and semantic checks. The read paths therefore
 * fall back to parsing source_document for unmaterialized revisions; this
 * script exists to retire that fallback.
 *
 * Safe to re-run: it only touches revisions that still have unmaterialized
 * rules, so a partial or interrupted run resumes cleanly.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node --import tsx scripts/backfill-policy-rule-matchers.mjs [--dry-run] [--batch=N]
 */

import postgres from "postgres";

const { parseAgtPolicyDocument } = await import("../packages/policy-schema/src/schema.ts");

const dryRun = process.argv.includes("--dry-run");
const batchArg = process.argv.find((arg) => arg.startsWith("--batch="));
const batchSize = batchArg ? Number.parseInt(batchArg.split("=")[1], 10) : 200;

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

/**
 * Normalises to an array, matching toPolicyRuleRows(). A rule with no matchers
 * must become `[]` rather than staying NULL — otherwise it looks unmaterialised
 * forever, the backfill never converges, and the read-path fallback can never
 * be retired.
 *
 * Returns a value rather than a JSON string: postgres serialises a JS string
 * bound to jsonb as a JSON *string*, storing "[]" instead of [].
 */
function matchersOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

async function main() {
  const [{ count: pending }] = await sql`
    SELECT count(DISTINCT revision_id)::int AS count
    FROM policy_rule
    WHERE semantic_checks IS NULL AND parameter_constraints IS NULL
  `;
  console.log(`${pending} revision(s) with unmaterialized rules.`);
  if (pending === 0) {
    console.log("Nothing to backfill.");
    return { updated: 0, skipped: 0, failed: 0 };
  }
  if (dryRun) console.log("Dry run — no writes will be made.\n");

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let lastRevisionId = "00000000-0000-0000-0000-000000000000";

  for (;;) {
    // Keyset pagination by revision id. Rows are updated as we go, so an
    // offset would skip records as the candidate set shrinks beneath us.
    const revisions = await sql`
      SELECT DISTINCT pr.id, pr.tenant_id, pr.source_document, pr.source_path
      FROM policy_revision pr
      JOIN policy_rule rule
        ON rule.revision_id = pr.id AND rule.tenant_id = pr.tenant_id
      WHERE rule.semantic_checks IS NULL
        AND rule.parameter_constraints IS NULL
        AND pr.id > ${lastRevisionId}
      ORDER BY pr.id
      LIMIT ${batchSize}
    `;
    if (revisions.length === 0) break;

    for (const revision of revisions) {
      lastRevisionId = revision.id;

      if (!revision.source_document) {
        // Nothing to recover from; the rule genuinely has no matchers.
        skipped += 1;
        continue;
      }

      let parsed;
      try {
        const document =
          typeof revision.source_document === "string"
            ? revision.source_document
            : JSON.stringify(revision.source_document);
        parsed = parseAgtPolicyDocument({
          document,
          sourcePath: revision.source_path ?? undefined,
        });
      } catch (error) {
        // Report and continue: one unparsable revision must not strand the
        // rest of the backfill.
        console.error(
          `  revision ${revision.id}: parse failed — ${error instanceof Error ? error.message : String(error)}`,
        );
        failed += 1;
        continue;
      }

      // Every parsed rule is materialised, not only those carrying matchers:
      // a rule left NULL would keep its revision in the pending set forever.
      const rules = parsed.rules ?? [];
      if (rules.length === 0) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        const withMatchers = rules.filter(
          (rule) => rule.semanticChecks?.length || rule.parameterConstraints?.length,
        );
        console.log(
          `  revision ${revision.id}: would materialise ${rules.length} rule(s), ` +
            `${withMatchers.length} carrying matchers`,
        );
        updated += rules.length;
        continue;
      }

      await sql.begin(async (tx) => {
        for (const rule of rules) {
          await tx`
            UPDATE policy_rule
            SET semantic_checks = ${sql.json(matchersOrEmpty(rule.semanticChecks))},
                parameter_constraints = ${sql.json(matchersOrEmpty(rule.parameterConstraints))}
            WHERE tenant_id = ${revision.tenant_id}
              AND revision_id = ${revision.id}
              AND stable_rule_id = ${rule.stableRuleId}
          `;
          updated += 1;
        }
      });
    }
  }

  return { updated, skipped, failed };
}

try {
  const { updated, skipped, failed } = await main();
  console.log(
    `\n${dryRun ? "Would materialise" : "Materialised"} ${updated} rule(s); ` +
      `${skipped} revision(s) had no parsable rules; ${failed} failed to parse.`,
  );
  if (failed > 0) {
    console.error("Some revisions could not be parsed — rerun after investigating.");
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
