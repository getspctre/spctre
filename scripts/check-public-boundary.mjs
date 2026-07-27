import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const forbiddenRoots = ["ee", "knowledge", "ops", "concepts"];
const ignoredDirs = new Set([".git", ".venv", "node_modules", "dist", "target", ".next", ".source", "storybook-static"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const root = process.cwd();
const failures = forbiddenRoots.filter((name) => existsSync(join(root, name))).map(
  (name) => `forbidden root directory present: ${name}/`
);

for (const file of await walk(root)) {
  if ([".gitignore", "scripts/check-public-boundary.mjs"].includes(relative(root, file))) continue;
  const text = await readFile(file, "utf8");
  if (/knowledge\/|\bops\/|\bconcepts\//.test(text)) {
    failures.push(`private-path reference: ${relative(root, file)}`);
  }
}

if (failures.length) {
  console.error(`Public boundary check failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("Public boundary check passed.");
