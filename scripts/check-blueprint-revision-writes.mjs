import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// agent_blueprint_revision has no global UNIQUE (blueprint_id, definition_hash)
// constraint (dropped in migration 006 so a definition can legitimately recur —
// e.g. a source rollback A→B→A). De-duplication and concurrency safety are now
// enforced in application code: createAgentBlueprintRevision locks the
// agent_blueprint row (SELECT ... FOR UPDATE), re-reads the head hash, and only
// then inserts. That serialization is the *sole* guard against duplicate
// revisions, so every INSERT into agent_blueprint_revision must go through that
// function. This check fails if a raw insert appears anywhere else, turning the
// invariant back into something CI enforces rather than a convention.
const allowed = new Set([
  "apps/web/lib/repositories/agent-blueprints.ts",
]);

const INSERT_RE = /insert\s+into\s+agent_blueprint_revision\b/i;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walk(fullPath);
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) {
      yield fullPath;
    }
  }
}

const offenders = ["apps/web/app", "apps/web/lib"]
  .flatMap((dir) => Array.from(walk(dir)))
  .filter((file) => INSERT_RE.test(readFileSync(file, "utf8")))
  .filter((file) => !allowed.has(file));

if (offenders.length > 0) {
  console.error(
    "Inserts into agent_blueprint_revision are restricted to the locked path in\n" +
      "apps/web/lib/repositories/agent-blueprints.ts (createAgentBlueprintRevision /\n" +
      "createAgentBlueprint). There is no DB uniqueness backstop; route revision\n" +
      "creation through that function so the per-Blueprint row lock prevents duplicates."
  );
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}

console.log("Blueprint revision write-path check passed.");
