/**
 * Emits the schema-registry tree published to https://schema.spctre.dev/.
 *
 * Two kinds of member (see `./catalog.ts`):
 *   - `source: "zod"`  — a JSON Schema document generated here and written
 *     into `EMIT_ROOT`, mirroring its published URL path.
 *   - `source: "file"` — a document that already exists on disk and is
 *     published as-is. Nothing is copied; the manifest records its path.
 *
 * Everything is derived from the catalog and sorted, so the output is a pure
 * function of the sources: running the emitter twice leaves the tree byte
 * identical. `scripts/check-schema-registry-sync.sh` depends on that.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import prettier from "prettier";
import { z } from "zod";

import {
  EMIT_ROOT,
  JSON_SCHEMA_DIALECT,
  REGISTRY_ARTIFACTS,
  REGISTRY_BASE,
  artifactId,
  artifactPath,
  artifactUrl,
  assertCoordinates,
  type RegistryArtifact,
} from "./catalog.js";

const MANIFEST_URL = `${REGISTRY_BASE}/manifest.json`;
const MANIFEST_PATH = `${EMIT_ROOT}/manifest.json`;

/**
 * Value of the manifest's `pathBase` field: every `path` it lists is relative
 * to the repository root. Published as an explicit contract term because the
 * manifest is consumed by a separate publishing pipeline that has only the
 * JSON to go on.
 */
const PATH_BASE = "repository-root";

interface ManifestEntry {
  id: string;
  kind: string;
  title: string;
  description: string;
  url: string;
  path: string;
  sha256: string;
}

/**
 * Writes through Prettier, using the repo's own config, so the emitted bytes
 * are by construction what `pnpm format:check` expects. Hand-rolling the
 * layout instead would force the generated tree out of formatting
 * verification, and the two would then be free to disagree.
 */
async function writeJson(absolutePath: string, value: unknown): Promise<void> {
  const options = await prettier.resolveConfig(absolutePath, { editorconfig: true });
  const formatted = await prettier.format(JSON.stringify(value, null, 2), {
    ...options,
    filepath: absolutePath,
    parser: "json",
  });
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, formatted);
}

function sha256(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

/**
 * Builds the published document for a catalog entry, or validates the
 * already-published one. Returns nothing; side effects land on disk.
 */
async function materialize(repoRoot: string, artifact: RegistryArtifact): Promise<void> {
  const absolutePath = join(repoRoot, artifactPath(artifact));
  const id = artifactUrl(artifact);

  if (artifact.source === "file") {
    // Not regenerated — but a hand-maintained schema must still agree with the
    // URL it is published at, or consumers resolving `$id` fetch a document
    // that disagrees with itself.
    if (artifact.kind !== "json-schema") return;
    const document: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
    const declared =
      typeof document === "object" && document !== null
        ? (document as Record<string, unknown>).$id
        : undefined;
    if (declared !== id) {
      throw new Error(
        `${artifactPath(artifact)} declares $id ${String(declared)}, but the registry publishes it at ${id}.`,
      );
    }
    return;
  }

  // `io: "input"` is the only mode that can be emitted at all: several sources
  // carry `.transform()` steps, and output mode throws outright on those. It
  // does not follow that the result is an exact description of what the API
  // accepts. Input mode describes the schema *before* its transforms, which
  // can be narrower than reality where a source preprocesses its input, and
  // says nothing about what a transform does to an accepted value. Both gaps,
  // along with every refinement JSON Schema cannot express, are enumerated in
  // the catalog and rendered here as `$comment`; the emitted keywords alone
  // are necessary but not sufficient for a payload to be accepted.
  const generated = z.toJSONSchema(artifact.schema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
  delete generated.$schema;
  delete generated.$id;
  delete generated.title;
  delete generated.description;

  await writeJson(absolutePath, {
    $schema: JSON_SCHEMA_DIALECT,
    $id: id,
    title: artifact.title,
    description: artifact.description,
    ...(artifact.unrepresentable ? { $comment: artifact.unrepresentable } : {}),
    ...generated,
  });
}

/** Removes generated documents under `EMIT_ROOT` that the catalog no longer lists. */
function prune(repoRoot: string, expected: Set<string>): void {
  const root = join(repoRoot, EMIT_ROOT);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
        continue;
      }
      if (!expected.has(relative(repoRoot, path))) rmSync(path);
    }
  };
  mkdirSync(root, { recursive: true });
  walk(root);
}

export async function emitRegistry(repoRoot: string, specRevision: string): Promise<string[]> {
  const artifacts = [...REGISTRY_ARTIFACTS].sort((a, b) =>
    artifactId(a).localeCompare(artifactId(b)),
  );

  // The URL and the dotted identifier are two renderings of the same
  // coordinates, so a collision in either is a collision in both. Checking
  // both anyway keeps the guarantee independent of that equivalence holding.
  const urls = new Set<string>();
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    assertCoordinates(artifact);
    const url = artifactUrl(artifact);
    const id = artifactId(artifact);
    if (urls.has(url)) throw new Error(`Duplicate registry URL ${url}.`);
    if (ids.has(id)) throw new Error(`Duplicate registry identifier ${id}.`);
    urls.add(url);
    ids.add(id);
    await materialize(repoRoot, artifact);
  }

  const generated = new Set(
    artifacts.filter((a) => a.source === "zod").map((a) => artifactPath(a)),
  );
  generated.add(MANIFEST_PATH);
  prune(repoRoot, generated);

  const entries: ManifestEntry[] = artifacts.map((artifact) => {
    const path = artifactPath(artifact);
    return {
      id: artifactId(artifact),
      kind: artifact.kind,
      title: artifact.title,
      description: artifact.description,
      url: artifactUrl(artifact),
      path,
      sha256: sha256(join(repoRoot, path)),
    };
  });

  await writeJson(join(repoRoot, MANIFEST_PATH), {
    registry: `${REGISTRY_BASE}/`,
    manifestUrl: MANIFEST_URL,
    dialect: JSON_SCHEMA_DIALECT,
    // Declares how every `path` below is to be resolved, so a consumer
    // reading only this JSON does not have to guess between the checkout
    // root, this file's own directory, and its working directory. It matters
    // because two artifacts publish in place from outside `EMIT_ROOT`
    // (the OpenAPI document and the policy bundle schema): resolving from
    // the wrong root silently drops them rather than erroring.
    pathBase: PATH_BASE,
    specRevision,
    artifacts: entries,
  });

  return [...entries.map((e) => e.path), MANIFEST_PATH];
}
