import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SPCTRE_OPENAPI_SPEC } from "../src/index.js";
import {
  JSON_SCHEMA_DIALECT,
  REGISTRY_ARTIFACTS,
  REGISTRY_BASE,
  SEGMENT_GRAMMAR,
  artifactId,
  artifactPath,
  artifactUrl,
} from "../scripts/registry/catalog.js";

/**
 * Walks a Zod schema's internal definition for the constructs JSON Schema
 * cannot express, so a disclosure can be demanded for each. Reaching into
 * `_zod.def` is the only way to ask this question — the public surface
 * exposes no reflection.
 *
 * Two categories, because they fail differently:
 *
 *   - `hasLogic` — transforms, preprocessing, and custom refinements. These
 *     have no JSON Schema rendering at all, so their absence is total.
 *   - `normalizedStrings` — fields carrying a normalizing string method
 *     (`.trim()`, `.toLowerCase()`, …, all of which Zod records as an
 *     `overwrite` check). These are the dangerous ones: the emitted document
 *     keeps the `minLength` that follows the normalization but drops the
 *     normalization itself, so it advertises acceptance of values the
 *     service rejects. Each is returned with its path so the disclosure can
 *     be checked for naming it.
 *
 * Cycle detection is scoped to the current ancestor chain rather than a
 * single shared visited set. A global set would silently skip a schema
 * instance reused across two fields — which is exactly how
 * `GitCommitSchema` (`baseCommit` and `headCommit`) escapes detection.
 */
function findUnrepresentable(schema: unknown): { hasLogic: boolean; normalizedStrings: string[] } {
  let hasLogic = false;
  const normalizedStrings: string[] = [];

  const walk = (node: unknown, path: string, ancestors: Set<unknown>): void => {
    if (!node || typeof node !== "object" || ancestors.has(node)) return;
    const def = (node as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (!def) return;
    const nested = new Set(ancestors).add(node);

    if (def.type === "transform") hasLogic = true;
    const checks = (def.checks ?? []) as Array<{ _zod?: { def?: { check?: string } } }>;
    for (const check of checks) {
      const kind = check._zod?.def?.check;
      if (kind === "custom") hasLogic = true;
      if (kind === "overwrite" && def.type === "string") normalizedStrings.push(path);
    }

    for (const key of ["innerType", "in", "out", "schema", "keyType"]) {
      walk(def[key], path, nested);
    }
    walk(def.element, `${path}[]`, nested);
    walk(def.valueType, `${path}[*]`, nested);
    for (const key of ["options", "items"]) {
      for (const [index, child] of ((def[key] ?? []) as unknown[]).entries()) {
        walk(child, `${path}|${index}`, nested);
      }
    }
    for (const [key, child] of Object.entries((def.shape ?? {}) as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key, nested);
    }
  };

  walk(schema, "", new Set());
  return { hasLogic, normalizedStrings };
}

/** Leaf identifier of a walked path: `checkpoint.diff.files[].path` -> `path`. */
function leafName(path: string): string {
  const last = path.split(".").pop() ?? path;
  return last
    .replaceAll("[]", "")
    .replaceAll("[*]", "")
    .replace(/\|\d+$/, "");
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "packages/api-contracts/schemas/manifest.json"), "utf8"),
) as {
  registry: string;
  specRevision: string;
  artifacts: Array<{ id: string; url: string; path: string; sha256: string }>;
};

describe("schema registry", () => {
  it("publishes every catalog entry exactly once", () => {
    expect(manifest.artifacts.map((a) => a.id).sort()).toEqual(
      REGISTRY_ARTIFACTS.map(artifactId).sort(),
    );
    expect(new Set(manifest.artifacts.map((a) => a.url)).size).toBe(manifest.artifacts.length);
  });

  it("records the spec revision, which is distinct from the frozen API version", () => {
    expect(manifest.specRevision).toBe(SPCTRE_OPENAPI_SPEC["x-spctre-spec-revision"]);
    expect(SPCTRE_OPENAPI_SPEC.info.version).toBe("2026-01");
    expect(manifest.specRevision).not.toBe(SPCTRE_OPENAPI_SPEC.info.version);
  });

  it("digests match the files on disk", () => {
    for (const entry of manifest.artifacts) {
      const absolute = join(repoRoot, entry.path);
      expect(existsSync(absolute), `${entry.path} is missing`).toBe(true);
      expect(createHash("sha256").update(readFileSync(absolute)).digest("hex")).toBe(entry.sha256);
    }
  });

  it("restricts every path segment to the documented grammar", () => {
    for (const artifact of REGISTRY_ARTIFACTS) {
      for (const segment of [artifact.domain, artifact.name, artifact.version]) {
        expect(segment, `${artifactId(artifact)} has an unpublishable segment`).toMatch(
          SEGMENT_GRAMMAR,
        );
      }
    }
    expect(new Set(REGISTRY_ARTIFACTS.map(artifactId)).size).toBe(REGISTRY_ARTIFACTS.length);
  });

  // A transform or refinement added to a source without a matching disclosure
  // would silently ship a published contract that overstates what it enforces.
  // That is the failure this guards: not that the prose is well written, but
  // that someone was made to write it.
  it("discloses every transform and refinement the emitted schema cannot express", () => {
    for (const artifact of REGISTRY_ARTIFACTS) {
      if (artifact.source !== "zod") continue;
      if (!findUnrepresentable(artifact.schema).hasLogic) continue;
      expect(
        artifact.unrepresentable,
        `${artifactId(artifact)} carries a transform or refinement with no \`unrepresentable\` disclosure`,
      ).toBeTruthy();
    }
  });

  // Normalized strings need a stronger check than "some prose exists".
  // `z.string().trim().min(1)` emits `minLength: 1` and drops the trim, so
  // the published document accepts `" "` while the service rejects it. A
  // disclosure that omits the field is exactly as misleading as no
  // disclosure, so require the field's own name to appear in the text.
  it("names every normalized string field in its disclosure", () => {
    for (const artifact of REGISTRY_ARTIFACTS) {
      if (artifact.source !== "zod") continue;
      const { normalizedStrings } = findUnrepresentable(artifact.schema);
      if (normalizedStrings.length === 0) continue;

      const disclosure = artifact.unrepresentable;
      expect(
        disclosure,
        `${artifactId(artifact)} normalizes ${normalizedStrings.length} string field(s) with no \`unrepresentable\` disclosure`,
      ).toBeTruthy();

      for (const path of new Set(normalizedStrings.map(leafName))) {
        expect(
          disclosure,
          `${artifactId(artifact)} trims or otherwise normalizes \`${path}\` without naming it in the disclosure, so the published $comment understates what the API rejects`,
        ).toContain(path);
      }
    }
  });

  it("emits the disclosure as $comment on exactly the schemas that declare one", () => {
    for (const artifact of REGISTRY_ARTIFACTS) {
      if (artifact.source !== "zod") continue;
      const document = JSON.parse(readFileSync(join(repoRoot, artifactPath(artifact)), "utf8")) as {
        $comment?: string;
      };
      expect(document.$comment).toBe(artifact.unrepresentable);
    }
  });

  // The publication-attestation contract is still in design; publishing it at
  // a permanent v1 URL would freeze a commitment it is not ready to make.
  it("withholds the publication-attestation contracts", () => {
    expect(REGISTRY_ARTIFACTS.filter((a) => a.domain === "publication")).toEqual([]);
    expect(manifest.artifacts.filter((a) => a.id.startsWith("spctre.publication."))).toEqual([]);
  });

  it("every schema document declares a resolvable registry $id and the 2020-12 dialect", () => {
    for (const artifact of REGISTRY_ARTIFACTS) {
      if (artifact.kind !== "json-schema") continue;
      const document = JSON.parse(readFileSync(join(repoRoot, artifactPath(artifact)), "utf8")) as {
        $id: string;
        $schema: string;
      };
      expect(document.$schema).toBe(JSON_SCHEMA_DIALECT);
      expect(document.$id).toBe(artifactUrl(artifact));
      expect(document.$id.startsWith(`${REGISTRY_BASE}/`)).toBe(true);
    }
  });
});
