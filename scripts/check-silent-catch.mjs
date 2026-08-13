import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Guards against re-introducing silent read/side-effect degradation.
//
// A bare `.catch(() => <fallback>)` collapses "no data", "query bug",
// "RLS misbind", and "database down" into the same healthy-looking empty
// state, masking latent bugs. Degrade through `swallow(op, fallback)` from
// `@/lib/platform/swallow` instead so every fallback is logged + counted.
//
// Allowed without `swallow`:
//   - HTTP body parses (`req.json()`, `res.text()`, …) — expected handling of
//     malformed/empty bodies, not data-layer masking.
//   - A non-empty catch block (`.catch(() => { ...handle... })`) that already
//     deals with the error explicitly.
//
// The promise form above is only half the surface. `try { … } catch { return
// fallback; }` masks exactly the same way — that statement form is how a
// reference to a non-existent column rendered the escalation queue as "Queue is
// clear" while this check passed. It is guarded below against a recorded
// baseline: the debt that predates the rule is grandfathered per file, and any
// *new* silent statement catch fails. Fix sites and lower the baseline with
// `node scripts/check-silent-catch.mjs --update`.
const checkedRoots = ["apps/web/lib", "apps/web/app"];
const BASELINE_PATH = "scripts/silent-catch-baseline.json";

const BODY_PARSE_BEFORE = /\.(json|text|formData|arrayBuffer|blob)\(\)\s*$/;
// A zero-arg arrow catch handler: `.catch(() =>` (also matches `.catch( () =>`).
const CATCH_ARROW = /\.catch\(\s*\(\)\s*=>/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) yield* walk(fullPath);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !/\.d\.ts$/.test(entry)) yield fullPath;
  }
}

// Only explicit non-empty handler blocks are allowed. Every expression handler
// (including variable and computed fallbacks) must go through `swallow`.
function isSilentCatchHandler(after) {
  const t = after.replace(/^\s+/, "");
  if (/^swallow\s*\(/.test(t)) return false; // already migrated
  if (/^\{\s*\}/.test(t)) return true; // empty block: () => {}
  if (t.startsWith("{")) return false; // non-empty block: handled explicitly
  return true;
}

// A `catch` / `catch (err)` statement block. The body is brace-matched below
// rather than regex-captured, so nested blocks do not truncate it.
const CATCH_STATEMENT = /\bcatch\s*(\([^)]*\))?\s*\{/g;

// Anything that makes the failure visible or hands it onward: a report call, a
// log, a rethrow, or returning an error response to the caller. `swallow` is
// included because a catch body may call it directly. `ctx.error` is the
// withApiRoute envelope's error response — the same disclosure as a bare
// Response.json, and the form new routes are expected to use.
const HANDLES_ERROR =
  /\b(reportSwallowedError|swallow|logger\s*\.|console\s*\.|throw\b|captureException|Response\s*\.\s*json|NextResponse|ctx\s*\.\s*error)/;

function blockBody(source, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, i);
    }
  }
  return source.slice(openBraceIndex + 1);
}

function findSilentStatementCatches(source) {
  const found = [];
  for (const match of source.matchAll(CATCH_STATEMENT)) {
    const openBrace = match.index + match[0].length - 1;
    const body = blockBody(source, openBrace);
    if (HANDLES_ERROR.test(body)) continue;
    found.push(source.slice(0, match.index).split("\n").length);
  }
  return found;
}

const violations = [];
const statementCounts = {};

for (const root of checkedRoots) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CATCH_ARROW)) {
      const before = source.slice(0, match.index);
      if (BODY_PARSE_BEFORE.test(before)) continue; // HTTP body parse: allowed
      const after = source.slice(match.index + match[0].length);
      if (isSilentCatchHandler(after)) {
        const line = before.split("\n").length;
        violations.push(
          `${file}:${line}: bare .catch(() => …) — degrade through swallow(op, fallback)`,
        );
      }
    }

    const silentStatements = findSilentStatementCatches(source);
    if (silentStatements.length > 0) {
      statementCounts[file] = { count: silentStatements.length, lines: silentStatements };
    }
  }
}

// Statement-form ratchet. Counts are per file rather than per line so ordinary
// edits above a catch do not invalidate the baseline.
const updating = process.argv.includes("--update");
const currentCounts = Object.fromEntries(
  Object.entries(statementCounts).map(([file, { count }]) => [file, count]),
);

if (updating) {
  const sorted = Object.fromEntries(
    Object.entries(currentCounts).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = Object.values(sorted).reduce((sum, n) => sum + n, 0);
  console.log(
    `Wrote ${BASELINE_PATH}: ${total} silent statement catch(es) across ${Object.keys(sorted).length} file(s).`,
  );
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(`Missing or unreadable ${BASELINE_PATH}. Run with --update to create it.`);
  process.exit(1);
}

const statementViolations = [];
for (const [file, { count, lines }] of Object.entries(statementCounts)) {
  const allowed = baseline[file] ?? 0;
  if (count > allowed) {
    statementViolations.push(
      `${file}: ${count} silent catch block(s), baseline allows ${allowed} ` +
        `(lines ${lines.join(", ")}) — report through reportSwallowedError(op, error), rethrow, or return an error response`,
    );
  }
}

// A baseline that is higher than reality has gone stale: the debt it records
// was paid down, and leaving the allowance in place would silently license the
// same number of new masking sites.
const staleBaseline = Object.entries(baseline).filter(
  ([file, allowed]) => (currentCounts[file] ?? 0) < allowed,
);

if (violations.length > 0) {
  console.error("Silent read/side-effect degradation check failed.");
  console.error(
    "Replace bare `.catch(() => fallback)` with `swallow(op, fallback)` from " +
      "@/lib/platform/swallow so the fallback is observable (logged + counted).\n",
  );
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

if (statementViolations.length > 0) {
  console.error("Silent read/side-effect degradation check failed (statement form).");
  console.error(
    "A `try { … } catch { return fallback; }` masks a failure exactly as a bare\n" +
      ".catch does. Make it observable, or let it propagate to a caller that\n" +
      "answers with an error.\n",
  );
  for (const v of statementViolations) console.error(`  - ${v}`);
  process.exit(1);
}

if (staleBaseline.length > 0) {
  console.error(`${BASELINE_PATH} is stale — these files improved:\n`);
  for (const [file, allowed] of staleBaseline) {
    console.error(`  - ${file}: baseline ${allowed}, now ${currentCounts[file] ?? 0}`);
  }
  console.error("\nLower the baseline: node scripts/check-silent-catch.mjs --update");
  process.exit(1);
}

const statementTotal = Object.values(currentCounts).reduce((sum, n) => sum + n, 0);
console.log(
  `Silent read/side-effect degradation check passed ` +
    `(${statementTotal} grandfathered statement catch(es) tracked in ${BASELINE_PATH}).`,
);
