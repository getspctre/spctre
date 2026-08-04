import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const ignoredDirs = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  ".turbo",
  ".venv",
  "dist",
  "node_modules",
  "storybook-static",
  "target",
]);

function extname(path) {
  const match = path.match(/(\.[^.]+)$/);
  return match?.[1] ?? "";
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(path, files);
    } else if (sourceExtensions.has(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

function walkTsconfigs(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkTsconfigs(path, files);
    } else if (/^tsconfig[^/]*\.json$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function isEePath(path) {
  return relative(root, path).split(sep)[0] === "ee";
}

function stripJsonComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function checkTsconfigAliases(file, violations) {
  let config;
  try {
    config = JSON.parse(stripJsonComments(readFileSync(file, "utf8")));
  } catch {
    return;
  }

  const rel = relative(root, file);
  const paths = config.compilerOptions?.paths ?? {};
  for (const [alias, targets] of Object.entries(paths)) {
    if (alias === "@ee/*" || alias.startsWith("@ee/") || alias.includes("/ee/")) {
      violations.push(`${rel}: path alias "${alias}" points at commercial-only namespace`);
    }

    for (const target of Array.isArray(targets) ? targets : []) {
      const normalizedTarget = String(target).replace(/\*+$/g, "");
      const resolvedTarget = resolve(dirname(file), normalizedTarget);
      if (isEePath(resolvedTarget)) {
        violations.push(`${rel}: path alias "${alias}" resolves into ee/: ${target}`);
      }
    }
  }
}

const violations = [];
const importPattern =
  /(?:import\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?|export\s+(?:type\s+)?[^'"()]*?\s+from\s+|import\s*\()\s*["']([^"']+)["']/g;

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (rel === "scripts/check-oss-boundary.mjs") continue;
  if (rel.split(sep)[0] === "ee") continue;

  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (
      specifier === "ee" ||
      specifier.startsWith("ee/") ||
      specifier.startsWith("@ee/") ||
      specifier.startsWith("@/ee/") ||
      specifier.startsWith("~/ee/") ||
      specifier.includes("/ee/")
    ) {
      violations.push(`${rel}: imports commercial-only module "${specifier}"`);
    }
  }
}

for (const file of walkTsconfigs(root)) {
  if (isEePath(file)) continue;
  checkTsconfigAliases(file, violations);
}

if (violations.length) {
  console.error("OSS boundary violation: non-ee code must not import from ee/.\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("OSS boundary check passed.");
