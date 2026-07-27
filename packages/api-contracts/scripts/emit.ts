import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { SPCTRE_OPENAPI_SPEC } from "../src/openapi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "../openapi.json");
writeFileSync(out, JSON.stringify(SPCTRE_OPENAPI_SPEC, null, 2) + "\n");
console.log(`wrote ${out}`);
