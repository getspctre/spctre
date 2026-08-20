// Stage the schema registry and the docs site into a single GitHub Pages artifact.
//
// GitHub Pages permits exactly one site per repository. The docs site already
// occupies the repository's Pages artifact (built by apps/docs and deployed by
// .github/workflows/docs-pages.yml), so this helper composes the schema
// registry artifacts into that same artifact. The registry's $ids then resolve
// on its custom domain (schema.spctre.dev) without a second Pages site.
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
//   - if an entry's source file is absent, or
//   - if a source file's digest does not match the digest in the manifest,
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
//   SCHEMA_PAGES_DOCS_OUT         built docs export to compose in
//                                 (default apps/docs/out)
//   SCHEMA_PAGES_STAGING_DIR      where the composed artifact is written
//                                 (default a fresh dir under the OS temp dir)
//   SCHEMA_PAGES_INDEX_PATH       site path for the published manifest index;
//                                 defaults to the manifest's own manifestUrl
//                                 (default manifest.json)
//   SCHEMA_PAGES_CNAME            custom domain written to the CNAME file
//                                 (default schema.spctre.dev)
//   SCHEMA_PAGES_BASE_URLS        comma-separated base URLs probed for the
//                                 overwrite check, in order
//   SCHEMA_PAGES_GITHUB_REPOSITORY "<owner>/<repo>" whose github.io Pages site
//                                 is appended to the probe list
//   SCHEMA_PAGES_SKIP_LIVE_CHECK  set to "1" to skip the overwrite check
//                                 (local testing only)
//
// Manifest contract (produced by the @spctre/api-contracts registry pipeline):
//   {
//     "registry": "https://schema.spctre.dev",
//     "manifestUrl": "https://schema.spctre.dev/manifest.json",
//     "artifacts": [
//       { "id": "...", "path": "<repo-relative source>",
//         "url": "<registry>/<domain>/<name>/<version>.json", "sha256": "<hex>" }
//     ]
//   }
// `immutable` is optional per entry; when absent it is inferred from the URL —
// URLs whose basename is latest.json/current.json/index.json or that contain a
// latest/current/index segment are mutable, everything else is immutable.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, dirname, join, relative, resolve } from "node:path";
import os from "node:os";

const env = process.env;

const repoRoot = resolve(env.SCHEMA_PAGES_REPO_ROOT || process.cwd());
const manifestPath = resolve(
  repoRoot,
  env.SCHEMA_PAGES_MANIFEST || "packages/api-contracts/schemas/manifest.json",
);
const docsOut = resolve(repoRoot, env.SCHEMA_PAGES_DOCS_OUT || "apps/docs/out");
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
  return { registry, manifestUrl, artifacts: data.artifacts };
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
  for (const other of [docsOut, repoRoot]) {
    if (stagingDir === other) {
      fail(`SCHEMA_PAGES_STAGING_DIR (${stagingDir}) must not equal a source path (${other})`);
    }
    const stagingToOther = relative(stagingDir, other);
    if (!stagingToOther.startsWith("..") && !isAbsolute(stagingToOther)) {
      fail(`SCHEMA_PAGES_STAGING_DIR (${stagingDir}) is a parent of source path ${other}`);
    }
  }
  const docsToStaging = relative(docsOut, stagingDir);
  if (!docsToStaging.startsWith("..") && !isAbsolute(docsToStaging)) {
    fail(`SCHEMA_PAGES_STAGING_DIR (${stagingDir}) is nested inside docs output ${docsOut}`);
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

  const byPath = new Map();
  const unique = [];
  for (const entry of entries) {
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
    const prior = byPath.get(urlPath);
    if (prior && prior !== entry.digest) {
      fail(`manifest lists conflicting digests for ${urlPath}; refusing to publish`);
    }
    if (!prior) {
      byPath.set(urlPath, entry.digest);
      unique.push({ ...entry, urlPath, immutable });
    }
  }
  return { registry, manifestUrl, entries: unique };
}

async function stage(entries, registry, manifestUrl, indexOverride) {
  if (!existsSync(docsOut)) {
    fail(`docs export missing at ${docsOut}; refusing to compose the Pages artifact without it`);
  }

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await cp(docsOut, stagingDir, { recursive: true });

  const stagedPaths = new Set(
    (await walkFiles(stagingDir)).map((file) => relative(stagingDir, file)),
  );

  for (const entry of entries) {
    if (stagedPaths.has(entry.urlPath)) {
      fail(`path collision: registry artifact ${entry.urlPath} conflicts with the docs output`);
    }
    const dest = join(stagingDir, entry.urlPath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(resolve(repoRoot, entry.path), dest);
    stagedPaths.add(entry.urlPath);
    log(`staged ${entry.urlPath} (${entry.immutable ? "immutable" : "mutable pointer"})`);
  }

  const indexUrl = indexOverride || manifestUrl || "manifest.json";
  const indexPath = (
    indexUrl.startsWith(registry) ? indexUrl.slice(registry.length) : indexUrl
  ).replace(/^\/+/, "");
  if (!stagedPaths.has(indexPath)) {
    await mkdir(dirname(join(stagingDir, indexPath)), { recursive: true });
    await writeFile(join(stagingDir, indexPath), readFileSync(manifestPath));
    log(`staged mutable index ${indexPath}`);
  }

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
      `${mutableCount} mutable) and the docs site into ${stagingDir} ` +
      `(${stagedFileCount} files total)`,
  );
  log("digests verified against the manifest; ready to upload");
}

main().catch((error) => {
  console.error(`[stage-pages-artifact] unexpected failure: ${error.stack || error}`);
  process.exit(1);
});
