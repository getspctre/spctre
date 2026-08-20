/**
 * Writes every checked-in artifact derived from this package:
 *
 *   - packages/api-contracts/openapi.json — the OpenAPI 3.1 document, consumed
 *     by the SDK generators and served at GET /api/v1/openapi.json.
 *   - packages/api-contracts/schemas/**   — the schema-registry tree published
 *     to https://schema.spctre.dev/, plus its manifest.
 *
 * Run via `pnpm generate`. Output is a pure function of the sources, so a
 * second run is a no-op; `pnpm check:schema-registry` enforces that.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { SPCTRE_OPENAPI_SPEC } from "../src/openapi.js";
import { emitRegistry } from "./registry/emit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");

const out = join(__dirname, "../openapi.json");
writeFileSync(out, JSON.stringify(SPCTRE_OPENAPI_SPEC, null, 2) + "\n");
console.log(`wrote ${out}`);

// After the spec, so the manifest digests the document this run produced.
for (const path of emitRegistry(repoRoot, SPCTRE_OPENAPI_SPEC["x-spctre-spec-revision"])) {
  console.log(`registry ${path}`);
}
