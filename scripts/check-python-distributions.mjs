// Validates scripts/python-distributions.json against the working tree.
//
// That file drives the Release (Python) matrix. Nothing else in CI exercises
// that workflow, so a path in it can rot silently: it has already gone stale
// twice, once when the SDK moved out of target/ and once when the facade
// package was renamed. Both were only discovered by dispatching a release and
// watching it fail. This makes the same mistake fail in pull-request CI.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MANIFEST = "scripts/python-distributions.json";

const distributions = JSON.parse(readFileSync(MANIFEST, "utf8"));
const errors = [];

if (!Array.isArray(distributions) || distributions.length === 0) {
  errors.push(`${MANIFEST} must be a non-empty array.`);
}

const seen = new Set();

for (const entry of distributions) {
  const label = entry?.project ?? JSON.stringify(entry);

  for (const field of ["project", "path", "version_file", "pypi_env", "testpypi_env"]) {
    if (typeof entry?.[field] !== "string" || entry[field].length === 0) {
      errors.push(`${label}: missing or empty "${field}".`);
    }
  }
  if (errors.length > 0 && !entry?.path) continue;

  if (seen.has(entry.project)) errors.push(`${label}: duplicate project name.`);
  seen.add(entry.project);

  if (!existsSync(entry.path) || !statSync(entry.path).isDirectory()) {
    errors.push(`${label}: path "${entry.path}" is not a directory.`);
  } else if (!existsSync(path.join(entry.path, "pyproject.toml"))) {
    errors.push(`${label}: "${entry.path}" has no pyproject.toml.`);
  }

  // The release workflow reads the base version out of this file with sed and
  // rewrites it to stamp a .devN suffix, so it must exist and be parseable.
  if (!existsSync(entry.version_file)) {
    errors.push(`${label}: version_file "${entry.version_file}" does not exist.`);
  } else {
    const contents = readFileSync(entry.version_file, "utf8");
    const match = contents.match(/^__version__ = "(.*)"$/m);
    if (!match) {
      errors.push(`${label}: "${entry.version_file}" has no __version__ = "..." line.`);
    } else if (!/^\d+\.\d+\.\d+/.test(match[1])) {
      errors.push(`${label}: version "${match[1]}" is not a release version.`);
    }
  }

  // Each pending PyPI publisher is unique on (owner, repo, workflow,
  // environment), so two distributions sharing an environment cannot both be
  // registered.
  for (const field of ["pypi_env", "testpypi_env"]) {
    const key = `${field}:${entry[field]}`;
    if (seen.has(key)) errors.push(`${label}: environment "${entry[field]}" is already used.`);
    seen.add(key);
  }
}

if (errors.length > 0) {
  console.error("Python distribution manifest is invalid:\n");
  for (const error of errors) console.error(`- ${error}`);
  console.error(`\nFix ${MANIFEST} or the paths it points at.`);
  process.exit(1);
}

console.log(`Python distribution manifest check passed (${distributions.length} distributions).`);
