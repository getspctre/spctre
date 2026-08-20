// Stage the schema registry into a standalone GitHub Pages artifact tree.
//
// The registry is hosted in its own Pages repository (parameterized in
// .github/workflows/publish-registry.yml) so its custom domain can be attached
// without disturbing the docs site, which keeps its own Pages deployment in
// .github/workflows/docs-pages.yml. This helper builds only the registry tree:
// the artifacts, the mutable manifest index, and the CNAME file.
//
// The manifest (packages/api-contracts/schemas/manifest.json, emitted by the
// @spctre/api-contracts registry pipeline) is the single source of truth. Each
// entry carries a repository-relative source `path`, a full registry `url`,
// and a SHA-256 digest of the exact source bytes. The publisher maps each
// `path` to its `url` rather than assuming the on-disk layout mirrors the
// published layout — most documents live under packages/api-contracts/schemas/,
// but two are published in place from their existing locations
// (packages/policy-schema/schemas/policy.schema.json and
// packages/api-contracts/openapi.json). Source bytes are copied verbatim; the
// digests are computed over those bytes, so nothing is reformatted.
//
// This helper refuses to publish an empty or partial registry:
//   - if the manifest is absent or unparseable,
//   - if an entry's source file is absent,
//   - if a source file's digest does not match the digest in the manifest, or
//   - if two artifacts stage to the same path (or collide with the manifest
//     index or the CNAME file),
// the process exits non-zero before anything is uploaded.
//
// Immutable (versioned) artifact paths are additionally protected at publish
// time: if the already-published bytes for such a path differ from what is
// being staged, the publish is refused. The published manifest index
// (/manifest.json) is the mutable pointer into the registry: it is rewritten
// on every publish and is never described as immutable.
//
// Environment:
//   SCHEMA_PAGES_REPO_ROOT        repository root that manifest source paths
//                                 resolve against (default: the working dir)
//   SCHEMA_PAGES_MANIFEST         path to the emission manifest, relative to
//                                 the repo root
//                                 (default packages/api-contracts/schemas/manifest.json)
//   SCHEMA_PAGES_STAGING_DIR      where the registry tree is written
//                                 (default a fresh dir under the OS temp dir)
//   SCHEMA_PAGES_INDEX_PATH       site path for the published manifest index;
//                                 defaults to the manifest's own manifestUrl
//                                 (default manifest.json)
//   SCHEMA_PAGES_CNAME            custom domain written to the CNAME file
//                                 (default schema.spctre.dev)
//   SCHEMA_PAGES_BASE_URLS        comma-separated base URLs probed for the
//                                 overwrite check, in order
//   SCHEMA_PAGES_GITHUB_REPOSITORY "<owner>/<repo>" of the registry's github.io
//                                 Pages site, appended to the probe list. In the
//                                 publishing workflow this is the registry
//                                 repository, not the source repository.
//   SCHEMA_PAGES_SKIP_LIVE_CHECK  set to "1" to skip the overwrite check
//                                 (local testing only)
//
// Manifest contract (produced by the @spctre/api-contracts registry pipeline):
//   {
//     "registry": "https://schema.spctre.dev",
//     "manifestUrl": "https://schema.spctre.dev/manifest.json",
//     "pathBase": "repository-root",
//     "artifacts": [
//       { "id": "...", "path": "<repo-relative source>",
//         "url": "<registry>/<domain>/<name>/<version>.json", "sha256": "<hex>" }
//     ]
//   }
// `pathBase` declares what source `path` values are relative to. Only
// "repository-root" is supported: paths resolve against the repository root. If
// the manifest declares any other value — or a non-string value — the publisher
// fails rather than guess. If it is absent the manifest predates the pathBase
// contract and paths are still resolved against the repository root, with a
// warning.
// `immutable` is optional per entry; when absent it is inferred from the URL —
// URLs whose basename is latest.json/current.json/index.json or that contain a
// latest/current/index segment are mutable, everything else is immutable.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, dirname, join, relative, resolve } from "node:path";
import os from "node:os";

const env = process.env;

const repoRoot = resolve(env.SCHEMA_PAGES_REPO_ROOT || process.cwd());
const manifestPath = resolve(
  repoRoot,
  env.SCHEMA_PAGES_MANIFEST || "packages/api-contracts/schemas/manifest.json",
);
const stagingDir = resolve(
  env.SCHEMA_PAGES_STAGING_DIR || join(os.tmpdir(), "spctre-pages-staging"),
);
const cname = env.SCHEMA_PAGES_CNAME || "schema.spctre.dev";

const githubRepository = env.SCHEMA_PAGES_GITHUB_REPOSITORY || "getspctre/spctre";
const [owner, repoName] = githubRepository.split("/");
const githubIoBase = `https://${owner}.github.io/${repoName}`;
const baseUrls = (env.SCHEMA_PAGES_BASE_URLS || `https://schema.spctre.dev,${githubIoBase}`)
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const MUTABLE_BASENAME = /^(latest|current|index)\.json$/;
const MUTABLE_SEGMENT = /(?:^|\/)(latest|current|index)(?:\/|$)/;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256(readFileSync(file));
}

function inferImmutable(urlPath) {
  const basename = urlPath.split("/").pop();
  return !MUTABLE_BASENAME.test(basename) && !MUTABLE_SEGMENT.test(urlPath);
}

function fail(message) {
  console.error(`[stage-pages-artifact] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[stage-pages-artifact] ${message}`);
}

function parseManifest(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    fail(`the manifest is not valid JSON: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail('unrecognized manifest shape; expected an object with "registry" and "artifacts"');
  }
  const registry = typeof data.registry === "string" ? data.registry.replace(/\/+$/, "") : "";
  if (!registry) {
    fail('the manifest is missing its "registry" base URL');
  }
  if (!Array.isArray(data.artifacts)) {
    fail('the manifest is missing its "artifacts" array');
  }
  const manifestUrl =
    typeof data.manifestUrl === "string" ? data.manifestUrl.replace(/\/+$/, "") : "";
  return { registry, manifestUrl, pathBase: data.pathBase, artifacts: data.artifacts };
}

const describeValue = (value) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "an array"
      : typeof value === "object"
        ? "an object"
        : `a ${typeof value}`;

function checkPathBaseContract(manifest) {
  if (manifest.pathBase === undefined) {
    log(
      "WARNING: the manifest does not declare a pathBase; it predates the pathBase " +
        "contract, so source paths are resolved against the repository root as before",
    );
    return;
  }
  if (typeof manifest.pathBase !== "string") {
    fail(
      `the manifest declares a non-string pathBase (${describeValue(manifest.pathBase)}); ` +
        'only "repository-root" is supported. Refusing to guess how source paths ' +
        "resolve.",
    );
  }
  if (manifest.pathBase !== "repository-root") {
    fail(
      `the manifest declares pathBase "${manifest.pathBase}", which this publisher does not ` +
        'support; only "repository-root" is supported. Refusing to guess how source ' +
        "paths resolve.",
    );
  }
  log(`source paths resolve against the repository root (pathBase "${manifest.pathBase}")`);
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== "object") {
    fail(`artifact entry #${index + 1} is not an object`);
  }
  const { id, path, url, sha256: sha256Hex, digest: digestHex, immutable } = entry;
  const digest = sha256Hex || digestHex;
  if (typeof path !== "string" || path.length === 0) {
    fail(`artifact entry #${index + 1} is missing a "path"`);
  }
  if (
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    fail(`artifact entry #${index + 1} has an unsafe source path: ${path}`);
  }
  if (typeof url !== "string" || url.length === 0) {
    fail(`artifact entry #${index + 1} (${path}) is missing a "url"`);
  }
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/i.test(digest)) {
    fail(`artifact entry #${index + 1} (${path}) has an invalid sha256 digest`);
  }
  return { id, path, url, digest: digest.toLowerCase(), immutable };
}

function registryUrlPath(entry, registry) {
  const origin = registry.replace(/\/+$/, "");
  if (!entry.url.startsWith(origin)) {
    fail(
      `artifact ${entry.id || entry.path} publishes at ${entry.url}, outside the registry ` +
        `origin ${origin}; refusing to publish`,
    );
  }
  const urlPath = entry.url.slice(origin.length).replace(/^\/+/, "");
  if (
    urlPath.length === 0 ||
    urlPath.startsWith("/") ||
    urlPath.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    fail(`artifact ${entry.id || entry.path} has an unsafe registry url: ${entry.url}`);
  }
  if (!urlPath.endsWith(".json")) {
    fail(
      `artifact ${entry.id || entry.path} publishes at ${entry.url}, which is not a .json ` +
        "document; registry artifacts must be JSON so they are served with " +
        "Content-Type: application/json",
    );
  }
  return urlPath;
}

function assertStagingIsSafe() {
  if (stagingDir === repoRoot) {
    fail(`SCHEMA_PAGES_STAGING_DIR (${stagingDir}) must not equal the repository root`);
  }
  const stagingToRoot = relative(stagingDir, repoRoot);
  if (!stagingToRoot.startsWith("..") && !isAbsolute(stagingToRoot)) {
    fail(`SCHEMA_PAGES_STAGING_DIR (${stagingDir}) is a parent of the repository root`);
  }
}

async function walkFiles(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function publishedDigest(urlPath) {
  let unreachable = true;
  let sawNotPublished = false;
  for (const base of baseUrls) {
    const url = `${base}/${urlPath}`;
    let response;
    try {
      response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    } catch {
      continue;
    }
    unreachable = false;
    if (response.status === 200) {
      return sha256(Buffer.from(await response.arrayBuffer()));
    }
    if (response.status === 404 || response.status === 410) {
      sawNotPublished = true;
      continue;
    }
  }
  if (unreachable) {
    fail(
      `cannot verify immutable path ${urlPath}: none of the base URLs was reachable ` +
        `(tried ${baseUrls.join(", ")}); refusing to publish without overwrite protection`,
    );
  }
  if (!sawNotPublished) {
    fail(
      `cannot verify immutable path ${urlPath}: every base URL responded with an ambiguous ` +
        `status; refusing to publish without overwrite protection`,
    );
  }
  return null;
}

async function verifyImmutableOverwrites(entries) {
  const immutable = entries.filter((entry) => entry.immutable);
  for (const entry of immutable) {
    const published = await publishedDigest(entry.urlPath);
    if (published === null) continue;
    if (published !== entry.digest) {
      fail(
        `refusing to overwrite already-published immutable path ${entry.urlPath}: published ` +
          `bytes (sha256 ${published}) differ from the staged artifact (sha256 ` +
          `${entry.digest}). Versioned schema paths must never change under the same URL; ` +
          "ship a new version segment instead.",
      );
    }
    log(`immutable path ${entry.urlPath} is already published with identical bytes (idempotent)`);
  }
}

function verifyAndNormalize(manifest) {
  const { registry, manifestUrl, artifacts } = manifest;

  let entries;
  try {
    entries = artifacts.map(normalizeEntry);
  } catch {
    process.exit(1);
  }
  if (entries.length === 0) {
    fail(
      `schema registry manifest at ${manifestPath} lists no artifacts; refusing an empty registry`,
    );
  }

  return {
    registry,
    manifestUrl,
    entries: entries.map((entry) => {
      const source = resolve(repoRoot, entry.path);
      if (relative(repoRoot, source).startsWith("..") || isAbsolute(relative(repoRoot, source))) {
        fail(`artifact ${entry.id || entry.path} resolves outside the repository root`);
      }
      if (!existsSync(source)) {
        fail(
          `artifact ${entry.id || entry.path} is missing at ${source}; refusing to publish a ` +
            "partial registry",
        );
      }
      const actual = sha256File(source);
      if (actual !== entry.digest) {
        fail(
          `digest mismatch for ${entry.path}: manifest records ${entry.digest} but the source ` +
            `file is ${actual}; refusing to publish unverified bytes`,
        );
      }
      const urlPath = registryUrlPath(entry, registry);
      const immutable =
        typeof entry.immutable === "boolean" ? entry.immutable : inferImmutable(urlPath);
      return { ...entry, urlPath, immutable };
    }),
  };
}

function assertDistinctStagedPaths(entries, indexPath) {
  const seen = new Map();
  for (const entry of entries) {
    if (entry.urlPath === "CNAME") {
      fail(`artifact ${entry.id || entry.path} would overwrite the CNAME file`);
    }
    if (entry.urlPath === indexPath) {
      fail(`artifact ${entry.id || entry.path} would overwrite the manifest index at ${indexPath}`);
    }
    const prior = seen.get(entry.urlPath);
    if (prior !== undefined) {
      fail(
        `path collision within the registry tree: artifacts "${prior}" and ` +
          `${entry.id || entry.path} both stage to ${entry.urlPath}; refusing to publish`,
      );
    }
    seen.set(entry.urlPath, entry.id || entry.path);
  }
}

async function stage(entries, registry, manifestUrl, indexOverride) {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  const indexUrl = indexOverride || manifestUrl || "manifest.json";
  const indexPath = (
    indexUrl.startsWith(registry) ? indexUrl.slice(registry.length) : indexUrl
  ).replace(/^\/+/, "");
  assertDistinctStagedPaths(entries, indexPath);

  for (const entry of entries) {
    const dest = join(stagingDir, entry.urlPath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(resolve(repoRoot, entry.path), dest);
    log(`staged ${entry.urlPath} (${entry.immutable ? "immutable" : "mutable pointer"})`);
  }

  await mkdir(dirname(join(stagingDir, indexPath)), { recursive: true });
  await writeFile(join(stagingDir, indexPath), readFileSync(manifestPath));
  log(`staged mutable index ${indexPath}`);

  await writeFile(join(stagingDir, "CNAME"), `${cname}\n`);
  log(`staged CNAME ${cname}`);
}

async function main() {
  assertStagingIsSafe();

  if (!existsSync(manifestPath)) {
    fail(
      `schema registry manifest not found at ${manifestPath}. The @spctre/api-contracts ` +
        "registry pipeline has not emitted one; refusing to publish an empty or partial " +
        "schema registry.",
    );
  }
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  checkPathBaseContract(manifest);
  const { registry, manifestUrl, entries } = verifyAndNormalize(manifest);

  const skipLiveCheck = env.SCHEMA_PAGES_SKIP_LIVE_CHECK === "1";
  if (skipLiveCheck) {
    log("SKIPPING live overwrite check (SCHEMA_PAGES_SKIP_LIVE_CHECK=1)");
  } else {
    await verifyImmutableOverwrites(entries);
  }

  await stage(entries, registry, manifestUrl, env.SCHEMA_PAGES_INDEX_PATH);

  const immutableCount = entries.filter((entry) => entry.immutable).length;
  const mutableCount = entries.length - immutableCount;
  const stagedFileCount = (await walkFiles(stagingDir)).length;
  log(
    `staged ${entries.length} registry artifacts (${immutableCount} immutable, ` +
      `${mutableCount} mutable) into ${stagingDir} (${stagedFileCount} files total)`,
  );
  log("digests verified against the manifest; ready to publish");
}

main().catch((error) => {
  console.error(`[stage-pages-artifact] unexpected failure: ${error.stack || error}`);
  process.exit(1);
});
