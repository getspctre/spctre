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
  artifactId,
  artifactPath,
  artifactUrl,
} from "../scripts/registry/catalog.js";

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
