// Fails when a Python distribution's shipped content changes without its
// version changing with it.
//
// The Python distributions are released by hand: Changesets covers npm only,
// so `packages/sdk-python` can be regenerated, reviewed and merged while PyPI
// still serves the previous wheel. Nothing said so. `check-python-sdk-sync.sh`
// guarantees the checked-in tree matches the spec, and that guarantee is what
// makes the gap invisible — the repository is self-consistent and the
// published artifact is a version behind.
//
// That is exactly what happened when the review and publish endpoints landed:
// the generated tree gained three operations, `_version.py` stayed at 0.4.0,
// and `spctre-sdk` on PyPI stayed at 0.4.0 without them.
//
// The rule: if anything a distribution ships changed, its version must have
// moved forward in the same pull request. Bumping the version does not publish
// anything — `release-python.yml` still has to be dispatched — but it makes the
// intent to release reviewable, and it makes an unreleased change impossible to
// merge silently.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MANIFEST = "scripts/python-distributions.json";

// Not shipped in the wheel, so a change to one of these needs no release.
// `uv.lock` pins the development environment; `pyproject.toml`'s own
// dependency table is what reaches a consumer, and that is not excluded.
const UNSHIPPED = [/(^|\/)tests\//, /(^|\/)uv\.lock$/, /(^|\/)\.python-version$/];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Probes that are expected to miss, so git's own stderr is noise here. */
function tryGit(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The commit this branch is being compared against. CI passes the pull
 * request's base explicitly; locally the tracked main is the useful default.
 */
function resolveBase() {
  const explicit = process.env.SPCTRE_BASE_SHA?.trim();
  if (explicit) {
    if (tryGit("cat-file", "-e", `${explicit}^{commit}`) !== null) return explicit;
    fail(
      `SPCTRE_BASE_SHA is set to ${explicit}, which is not a commit in this clone. ` +
        "A shallow checkout cannot answer this check; fetch the base ref first.",
    );
  }
  for (const candidate of ["origin/main", "main"]) {
    if (tryGit("rev-parse", "--verify", `${candidate}^{commit}`) !== null) return candidate;
  }
  return null;
}

function fail(message) {
  console.error(`Python release-version check failed:\n\n${message}\n`);
  process.exit(1);
}

/** `__version__ = "1.2.3"` at a given revision, or null when absent there. */
function versionAt(revision, file) {
  const contents =
    revision === null ? readFileSync(file, "utf8") : tryGit("show", `${revision}:${file}`);
  if (contents === null) return null;
  const match = contents.match(/^__version__ = "(.*)"$/m);
  return match ? match[1] : null;
}

/** Compares two dotted release versions numerically, longest-wins on ties. */
function isForward(before, after) {
  const parse = (value) => value.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const a = parse(before);
  const b = parse(after);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = Number.isNaN(a[i]) ? 0 : (a[i] ?? 0);
    const right = Number.isNaN(b[i]) ? 0 : (b[i] ?? 0);
    if (right > left) return true;
    if (right < left) return false;
  }
  return false;
}

const base = resolveBase();
if (base === null) {
  // Refusing to pass quietly in CI: a missing base there means the check did
  // not run, and "did not run" must not read as "nothing to release".
  if (process.env.CI) {
    fail(
      "No base commit to compare against. Set SPCTRE_BASE_SHA, or fetch enough " +
        "history for origin/main to resolve.",
    );
  }
  console.log("Python release-version check skipped: no base commit to compare against.");
  process.exit(0);
}

const distributions = JSON.parse(readFileSync(MANIFEST, "utf8"));
const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
const problems = [];

for (const entry of distributions) {
  const root = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
  const shipped = changed.filter(
    (file) =>
      file.startsWith(root) &&
      file !== entry.version_file &&
      !UNSHIPPED.some((pattern) => pattern.test(file.slice(root.length))),
  );
  if (shipped.length === 0) continue;

  const before = versionAt(base, entry.version_file);
  const after = versionAt(null, entry.version_file);

  if (after === null) {
    problems.push(`${entry.project}: ${entry.version_file} has no __version__ line.`);
    continue;
  }
  if (before === null) continue; // New distribution; nothing to move forward from.

  if (before === after) {
    problems.push(
      `${entry.project}: ${shipped.length} shipped file(s) changed but ${path.basename(
        entry.version_file,
      )} is still ${after}.\n` +
        shipped
          .slice(0, 5)
          .map((file) => `    ${file}`)
          .join("\n") +
        (shipped.length > 5 ? `\n    …and ${shipped.length - 5} more` : ""),
    );
  } else if (!isForward(before, after)) {
    problems.push(`${entry.project}: version moved backwards, ${before} → ${after}.`);
  }
}

if (problems.length > 0) {
  fail(
    `${problems.join("\n\n")}\n\n` +
      "Bump the version file in this pull request. Publishing is still a separate, " +
      "deliberate step: dispatch release-python.yml once this is merged.",
  );
}

console.log(
  `Python release-version check passed (${distributions.length} distribution(s), base ${base}).`,
);
