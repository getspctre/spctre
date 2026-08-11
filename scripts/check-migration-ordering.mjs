import { readdirSync } from "node:fs";

// The migration runner applies files in lexical filename order, so the numeric
// prefix is the only thing establishing "before" and "after". Two migrations
// sharing a prefix still apply — in an order decided by the rest of the
// filename — which means the deployed schema depends on a name nobody chose
// deliberately, and two branches can each add "040_" without conflicting in
// git. This check makes that collision a merge-time failure instead of a
// deploy-time surprise.
const migrationsDir = "db/migrations";
const migrationPattern = /^(\d+)_[a-z0-9_]+\.sql$/;

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const violations = [];
const byPrefix = new Map();

for (const file of files) {
  const match = migrationPattern.exec(file);
  if (!match) {
    violations.push(`${migrationsDir}/${file}: filename must be <number>_<lower_snake_case>.sql`);
    continue;
  }
  const prefix = match[1];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}

for (const [prefix, owners] of byPrefix) {
  if (owners.length > 1) {
    violations.push(
      `duplicate migration prefix ${prefix}: ${owners.join(", ")} — renumber all but one to the next free prefix`,
    );
  }
}

// A gap is not a correctness problem for a lexical runner, but it usually means
// a migration was renamed or dropped after being applied somewhere. Report it
// as a warning so it gets a second look without blocking.
const prefixes = [...byPrefix.keys()].map(Number).sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < prefixes.length; i++) {
  if (prefixes[i] !== prefixes[i - 1] + 1) {
    gaps.push(`${prefixes[i - 1]} -> ${prefixes[i]}`);
  }
}

// Zero-padding width must be consistent or lexical order diverges from numeric
// order (e.g. "9_x.sql" sorts after "10_x.sql").
const widths = new Set([...byPrefix.keys()].map((prefix) => prefix.length));
if (widths.size > 1) {
  violations.push(
    `inconsistent migration prefix widths (${[...widths].sort().join(", ")}): lexical order stops matching numeric order`,
  );
}

if (gaps.length > 0) {
  console.warn(`warning: gaps in migration numbering: ${gaps.join(", ")}`);
}

if (violations.length > 0) {
  console.error("Migration ordering check failed:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log(`Migration ordering check passed (${files.length} migrations).`);
