#!/usr/bin/env tsx
/**
 * Creates a service account API key scoped for the e2e test suite and prints
 * the raw token to stdout. Run once after `pnpm migrate && pnpm seed`.
 *
 * Usage:
 *   pnpm --filter @spctre/web exec tsx scripts/create-e2e-token.ts
 *
 * Reads DATABASE_URL from (in order): shell env → .env.local → .env
 * Copy the printed token into spctre-e2e/.env as SPCTRE_SERVICE_TOKEN.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { randomBytes, createHash } from "node:crypto";

// Load .env.local / .env from the web app root (this file lives in scripts/)
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
      const val = stripped
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // file doesn't exist — skip
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not found in shell env, .env.local, or .env");
  process.exit(1);
}

const DEMO_TENANT_ID = process.env.SPCTRE_DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const DEMO_WORKSPACE_ID =
  process.env.SPCTRE_DEMO_WORKSPACE_ID ?? "00000000-0000-0000-0000-000000000002";
const DEMO_PRINCIPAL_ID =
  process.env.SPCTRE_DEMO_PRINCIPAL_ID ?? "00000000-0000-0000-0000-000000000013";

const LABEL = "e2e-test-token";

// Must match the service_token_scopes_check constraint (latest migration).
const ALL_SCOPES = [
  "bundle:read",
  "decision:evaluate",
  "evidence:write",
  "heartbeat:write",
  "compliance:read",
  "simulation:run",
  "operations:read",
  "e2e:write",
];

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

async function main() {
  // Revoke any existing e2e token with the same label so re-runs are idempotent
  await sql`
    DELETE FROM service_token
    WHERE tenant_id = ${DEMO_TENANT_ID}
      AND workspace_id = ${DEMO_WORKSPACE_ID}
      AND label = ${LABEL}
  `;

  const rawToken = `spctre_svc_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = rawToken.slice(0, 16);

  await sql`
    INSERT INTO service_token (
      tenant_id, workspace_id, principal_id, label,
      token_hash, token_prefix, scopes, expires_at, key_type, created_by
    ) VALUES (
      ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${DEMO_PRINCIPAL_ID},
      ${LABEL}, ${tokenHash}, ${tokenPrefix},
      ${ALL_SCOPES}::text[], NULL,
      'API_KEY', ${DEMO_PRINCIPAL_ID}
    )
  `;

  console.log("\nE2E service token created successfully.");
  console.log("Copy the line below into spctre-e2e/.env:\n");
  console.log(`SPCTRE_SERVICE_TOKEN=${rawToken}`);
  console.log("");
}

main()
  .catch((err) => {
    console.error("Failed to create e2e token:", err.message);
    process.exit(1);
  })
  .finally(() => sql.end());
