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
import { z } from "zod";

import {
  EMIT_ROOT,
  JSON_SCHEMA_DIALECT,
  REGISTRY_ARTIFACTS,
  REGISTRY_BASE,
  artifactId,
  artifactPath,
  artifactUrl,
  type RegistryArtifact,
} from "./catalog.js";

const MANIFEST_URL = `${REGISTRY_BASE}/manifest.json`;
const MANIFEST_PATH = `${EMIT_ROOT}/manifest.json`;

interface ManifestEntry {
  id: string;
  kind: string;
  title: string;
  description: string;
  url: string;
  path: string;
  sha256: string;
}

function writeJson(absolutePath: string, value: unknown): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

/**
 * Builds the published document for a catalog entry, or validates the
 * already-published one. Returns nothing; side effects land on disk.
 */
function materialize(repoRoot: string, artifact: RegistryArtifact): void {
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

  // `io: "input"` describes what a client sends. Several sources carry
  // `.transform()`/`.superRefine()` steps that JSON Schema cannot represent;
  // output mode therefore throws outright, while input mode yields the
  // accurate pre-transform wire contract. The constraints lost that way are
  // named in the catalog and surface here as `$comment`.
  const generated = z.toJSONSchema(artifact.schema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
  delete generated.$schema;
  delete generated.$id;
  delete generated.title;
  delete generated.description;

  writeJson(absolutePath, {
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

export function emitRegistry(repoRoot: string, specRevision: string): string[] {
  const artifacts = [...REGISTRY_ARTIFACTS].sort((a, b) =>
    artifactId(a).localeCompare(artifactId(b)),
  );

  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const url = artifactUrl(artifact);
    if (seen.has(url)) throw new Error(`Duplicate registry URL ${url}.`);
    seen.add(url);
    materialize(repoRoot, artifact);
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

  writeJson(join(repoRoot, MANIFEST_PATH), {
    registry: `${REGISTRY_BASE}/`,
    manifestUrl: MANIFEST_URL,
    dialect: JSON_SCHEMA_DIALECT,
    specRevision,
    artifacts: entries,
  });

  return [...entries.map((e) => e.path), MANIFEST_PATH];
}
