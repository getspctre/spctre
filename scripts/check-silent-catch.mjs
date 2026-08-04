import { readFileSync, readdirSync, statSync } from "node:fs";
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
const checkedRoots = ["apps/web/lib", "apps/web/app"];

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

const violations = [];

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
  }
}

if (violations.length > 0) {
  console.error("Silent read/side-effect degradation check failed.");
  console.error(
    "Replace bare `.catch(() => fallback)` with `swallow(op, fallback)` from " +
      "@/lib/platform/swallow so the fallback is observable (logged + counted).\n",
  );
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log("Silent read/side-effect degradation check passed.");
