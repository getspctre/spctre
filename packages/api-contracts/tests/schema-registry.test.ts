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
 * Walks a Zod schema's internal definition looking for the constructs JSON
 * Schema cannot express: value transforms, input preprocessing, and custom
 * refinements. Reaching into `_zod.def` is the only way to ask this question —
 * the public surface exposes no reflection — so this is deliberately narrow:
 * it answers "does anything here need disclosing", nothing more.
 */
function hasUnrepresentableLogic(schema: unknown): boolean {
  const visited = new Set<unknown>();

  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== "object" || visited.has(node)) return false;
    const def = (node as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (!def) return false;
    visited.add(node);

    if (def.type === "transform") return true;
    for (const check of (def.checks ?? []) as Array<{ _zod?: { def?: { check?: string } } }>) {
      if (check._zod?.def?.check === "custom") return true;
    }

    for (const key of ["innerType", "in", "out", "element", "valueType", "keyType", "schema"]) {
      if (walk(def[key])) return true;
    }
    for (const key of ["options", "items"]) {
      for (const child of (def[key] ?? []) as unknown[]) if (walk(child)) return true;
    }
    for (const child of Object.values((def.shape ?? {}) as Record<string, unknown>)) {
      if (walk(child)) return true;
    }
    return false;
  };

  return walk(schema);
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
      if (!hasUnrepresentableLogic(artifact.schema)) continue;
      expect(
        artifact.unrepresentable,
        `${artifactId(artifact)} carries a transform or refinement with no \`unrepresentable\` disclosure`,
      ).toBeTruthy();
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
