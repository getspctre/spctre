#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    const content = readFileSync(resolve(appRoot, file), "utf8");
    for (const line of content.split("\n")) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) continue;
      const eq = stripped.indexOf("=");
      if (eq === -1) continue;
      const key = stripped.slice(0, eq).trim();
      const val = stripped.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* skip missing file */ }
}

const { ensureDemoTenant } = await import("../lib/repositories/seed/local-dev.js");
await ensureDemoTenant();
console.log("Seed complete.");
process.exit(0);
