import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// postgres serializes sql.json(value) as a JSON value. Passing a pre-stringified
// value to a JSONB column stores a JSON string instead, breaking structural
// JSONB reads and operators. Keep JSON serialization at the database boundary.
const checkedRoots = ["apps", "packages", "db", "scripts"];
const forbidden = /\$\{\s*JSON\.stringify\([\s\S]*?\)\s*\}::jsonb/;
const forbiddenWrappedJsonb = /\$\{[^}]*JSON\.stringify\([^}]*\)[^}]*\}::jsonb/;
const forbiddenRepositoryBinding = /\$\{\s*JSON\.stringify\(/;
const forbiddenSourceDocument = /\$\{\s*JSON\.stringify\((?:params\.)?sourceDocument(?:Json)?\)\s*\}/;
const repositoryRoot = "apps/web/lib/repositories/";
const allowComment = "jsonb-serialization-allow";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if ([".next", "node_modules", "dist", "coverage"].includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) yield* walk(fullPath);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) yield fullPath;
  }
}

const violations = [];
for (const root of checkedRoots) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    const preSerializedJsonNames = [...source.matchAll(/\b([A-Za-z_$][\w$]*Json)\s*=\s*JSON\.stringify\(/g)].map((match) => match[1]);
    if (file.startsWith(repositoryRoot) && /\bas never\b/.test(source)) {
      violations.push(`${file}: unsafe as never cast in repository code`);
    }
    lines.forEach((line, index) => {
      if (!line.includes("${")) return;
      const sqlFragment = lines.slice(index, index + 8).join("\n");
      const isAllowed = sqlFragment.includes(allowComment);
      const hasForbiddenJsonbBinding = forbidden.test(sqlFragment) || forbiddenWrappedJsonb.test(sqlFragment);
      const hasForbiddenRepositoryBinding = file.startsWith(repositoryRoot) && forbiddenRepositoryBinding.test(sqlFragment);
      if (!isAllowed && (hasForbiddenJsonbBinding || forbiddenSourceDocument.test(line) || hasForbiddenRepositoryBinding)) {
        violations.push(`${file}:${index + 1}`);
      }
    });
    for (const name of preSerializedJsonNames) {
      if (new RegExp(`\\$\\{\\s*${name}\\s*\\}::jsonb`).test(source)) {
        violations.push(`${file}: pre-serialized ${name} bound as jsonb`);
      }
    }
  }
}

if (violations.length) {
  console.error("JSONB serialization check failed. Use sql.json(value) or tx.json(value) for JSON document bindings; encrypted/text bindings require an inline jsonb-serialization-allow comment.");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log("JSONB serialization check passed.");
