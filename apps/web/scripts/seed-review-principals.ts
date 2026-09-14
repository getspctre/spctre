#!/usr/bin/env tsx
/**
 * Seeds two reviewer principals in a workspace and issues one API key to each.
 *
 * A two-role approval workflow cannot be satisfied by one identity: an approval
 * is unique per (revision, reviewer), so the same reviewer approving twice
 * replaces their own decision rather than adding a second. Exercising the
 * reviewed path -- in the UI or through `approvals:write` -- therefore needs two
 * principals holding different reviewer roles. This creates them.
 *
 * Idempotent: re-running updates the grants and rotates the keys.
 *
 * Usage (local):
 *   pnpm --filter @spctre/web exec tsx scripts/seed-review-principals.ts
 *
 * Usage (a deployed environment), through a Cloud SQL Auth Proxy or equivalent
 * -- the database is not reachable from the internet by design:
 *   DATABASE_URL=... SPCTRE_SEED_TENANT_ID=... SPCTRE_SEED_WORKSPACE_ID=... \
 *     pnpm --filter @spctre/web exec tsx scripts/seed-review-principals.ts
 *
 * Reads DATABASE_URL from (in order): shell env -> .env.local -> .env.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";

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
      const value = stripped
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no such file -- skip
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not found in shell env, .env.local, or .env");
  process.exit(1);
}

const TENANT_ID = process.env.SPCTRE_SEED_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const WORKSPACE_ID = process.env.SPCTRE_SEED_WORKSPACE_ID ?? "00000000-0000-0000-0000-000000000002";

interface SeedReviewer {
  subject: string;
  displayName: string;
  email: string;
  reviewerRoles: string[];
  publishScopes: string[];
  /** Publishing is a separate authority from reviewing; only one seed holds it. */
  canPublish: boolean;
  envVar: string;
}

const REVIEWERS: SeedReviewer[] = [
  {
    subject: "seed:review-security",
    displayName: "Seed Security Reviewer",
    email: "seed-security-reviewer@spctre.invalid",
    reviewerRoles: ["Security"],
    publishScopes: [],
    canPublish: false,
    envVar: "SPCTRE_SECURITY_REVIEWER_TOKEN",
  },
  {
    subject: "seed:review-platform",
    displayName: "Seed Platform Reviewer",
    email: "seed-platform-reviewer@spctre.invalid",
    reviewerRoles: ["Platform"],
    publishScopes: ["WORKSPACE", "ENVIRONMENT", "CONNECTOR"],
    canPublish: true,
    envVar: "SPCTRE_PLATFORM_REVIEWER_TOKEN",
  },
];

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

async function seedReviewer(reviewer: SeedReviewer): Promise<string> {
  const [principal] = await sql<{ id: string }[]>`
    INSERT INTO app_principal (tenant_id, subject, display_name, email, auth_method, org_role)
    VALUES (${TENANT_ID}, ${reviewer.subject}, ${reviewer.displayName}, ${reviewer.email},
            'SESSION', 'REVIEWER')
    ON CONFLICT (tenant_id, subject)
      DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email
    RETURNING id
  `;

  await sql`
    INSERT INTO principal_permission_grant (
      tenant_id, principal_id, workspace_id, reviewer_roles, publish_scopes,
      allowed_environments, grant_role
    ) VALUES (
      ${TENANT_ID}, ${principal.id}, ${WORKSPACE_ID},
      ${reviewer.reviewerRoles}::text[], ${reviewer.publishScopes}::text[],
      ARRAY['development', 'staging', 'production']::text[], 'REVIEWER'
    )
    ON CONFLICT (principal_id, workspace_id)
      DO UPDATE SET reviewer_roles = EXCLUDED.reviewer_roles,
                    publish_scopes = EXCLUDED.publish_scopes,
                    allowed_environments = EXCLUDED.allowed_environments
  `;

  // The key inherits this principal, so it can only ever approve in the roles
  // granted above -- the token is a delegated credential, not an escalation.
  const scopes = [
    "bundle:read",
    "approvals:read",
    "approvals:write",
    "policy:import",
    ...(reviewer.canPublish ? ["publish:write"] : []),
  ];

  const label = `${reviewer.subject}-key`;
  await sql`
    DELETE FROM service_token
    WHERE tenant_id = ${TENANT_ID} AND workspace_id = ${WORKSPACE_ID} AND label = ${label}
  `;

  const rawToken = `spctre_svc_${randomBytes(32).toString("base64url")}`;
  await sql`
    INSERT INTO service_token (
      tenant_id, workspace_id, principal_id, label,
      token_hash, token_prefix, scopes, expires_at, key_type, created_by
    ) VALUES (
      ${TENANT_ID}, ${WORKSPACE_ID}, ${principal.id}, ${label},
      ${createHash("sha256").update(rawToken).digest("hex")}, ${rawToken.slice(0, 16)},
      ${scopes}::text[], NULL, 'API_KEY', ${principal.id}
    )
  `;

  return rawToken;
}

async function main() {
  console.log(`Seeding reviewers in workspace ${WORKSPACE_ID} (tenant ${TENANT_ID})\n`);
  for (const reviewer of REVIEWERS) {
    const token = await seedReviewer(reviewer);
    console.log(`# ${reviewer.displayName} -- roles: ${reviewer.reviewerRoles.join(", ")}`);
    console.log(`${reviewer.envVar}=${token}\n`);
  }
  console.log("Copy the lines above into spctre-e2e/.env (or .env.staging).");
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed reviewers:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => sql.end());
