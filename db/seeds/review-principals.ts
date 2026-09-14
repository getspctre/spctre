#!/usr/bin/env tsx
/**
 * Seeds two reviewer principals in a workspace and issues one API key to each.
 *
 * Lives beside the migrations because it needs the same credential they do: the
 * tables it writes are RLS-scoped, so it runs on the owner connection. That is
 * also why it ships in the migrate image -- `db/` is copied wholesale -- and can
 * therefore be run inside a deployed environment's VPC without opening a path
 * to the database from anywhere else.
 *
 * A two-role approval workflow cannot be satisfied by one identity: an approval
 * is unique per (revision, reviewer), so the same reviewer approving twice
 * replaces their own decision rather than adding a second. Exercising the
 * reviewed path -- in the UI or through `approvals:write` -- therefore needs two
 * principals holding different reviewer roles. This creates them, and the
 * workflow that requires both.
 *
 * The workflow half is not optional. A workspace with no approval-workflow rows
 * falls back to a single `Admin` approval (see `approvalRulesFromWorkflow`),
 * which is the right default for the operator who just provisioned a tenant and
 * is the wrong shape for this fixture: one reviewer satisfies it, so nothing
 * about two seats is exercised. Seeding reviewers without seeding the workflow
 * produces principals no workflow asks for.
 *
 * Idempotent: re-running updates the grants and rotates the keys.
 *
 * Usage (local):
 *   pnpm exec tsx db/seeds/review-principals.ts
 *
 * Usage (a deployed environment) -- as a task on the migrate job, which already
 * holds the owner connection and sits inside the VPC. The database has no public
 * address, so this is the supported path rather than a workaround:
 *
 *   gcloud run jobs execute <prefix>-migrate --region <region> --wait \
 *     --args="node_modules/.bin/tsx,db/seeds/review-principals.ts" \
 *     --update-env-vars=SPCTRE_SEED_TENANT_ID=...,SPCTRE_SEED_WORKSPACE_ID=...
 *
 * The overrides apply to that execution only; the job keeps running migrations.
 *
 * There, the keys are written to the Secret Manager secret named by
 * SPCTRE_SEED_KEYS_SECRET and never printed -- a job's stdout is its execution
 * log, which is the wrong home for a live bearer token. Locally, with no secret
 * named, they are printed to the terminal instead.
 *
 * Reads DATABASE_URL from (in order): shell env -> .env.local -> .env.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const file of [".env.local", ".env"]) {
  try {
    const content = readFileSync(resolve(repoRoot, file), "utf8");
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
/**
 * Where to put the keys when there is somewhere safe to put them: a Secret
 * Manager secret, as `projects/<p>/secrets/<name>`. Set on a deployed
 * environment, unset locally.
 */
const KEYS_SECRET = process.env.SPCTRE_SEED_KEYS_SECRET ?? "";
const WORKSPACE_ID = process.env.SPCTRE_SEED_WORKSPACE_ID ?? "00000000-0000-0000-0000-000000000002";

interface SeedReviewer {
  displayName: string;
  /**
   * Also the principal's `subject`. A magic-link sign-in carries both, and the
   * tenant provisioner keeps them equal; matching that here means a seeded
   * reviewer can hold a browser session as well as a key.
   */
  email: string;
  reviewerRoles: string[];
  publishScopes: string[];
  /** Publishing is a separate authority from reviewing; only one seed holds it. */
  canPublish: boolean;
  envVar: string;
}

const REVIEWERS: SeedReviewer[] = [
  {
    displayName: "Seed Security Reviewer",
    email: "seed-security-reviewer@spctre.invalid",
    reviewerRoles: ["Security"],
    publishScopes: [],
    canPublish: false,
    envVar: "SPCTRE_SECURITY_REVIEWER_TOKEN",
  },
  {
    displayName: "Seed Platform Reviewer",
    email: "seed-platform-reviewer@spctre.invalid",
    reviewerRoles: ["Platform"],
    publishScopes: ["WORKSPACE", "ENVIRONMENT", "CONNECTOR"],
    canPublish: true,
    envVar: "SPCTRE_PLATFORM_REVIEWER_TOKEN",
  },
];

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

/**
 * Requires one approval from each seeded reviewer's role, replacing whatever
 * the workspace had. Scoped to the workspace with no environment, which is the
 * row `getApprovalWorkflowForContext` resolves for an unscoped branch.
 */
async function seedApprovalWorkflow(): Promise<string[]> {
  const roles = REVIEWERS.flatMap((reviewer) => reviewer.reviewerRoles);

  const [workflow] = await sql<{ id: string }[]>`
    INSERT INTO approval_workflow_config (tenant_id, workspace_id, environment, name, review_mode)
    VALUES (${TENANT_ID}, ${WORKSPACE_ID}, NULL, 'Seeded review workflow', 'PARALLEL')
    ON CONFLICT (tenant_id, workspace_id, environment)
      DO UPDATE SET name = EXCLUDED.name, review_mode = EXCLUDED.review_mode, enabled = true,
                    updated_at = now()
    RETURNING id
  `;

  // Rewritten rather than merged: a seed that only ever adds rules cannot
  // narrow a workflow it widened on an earlier run.
  await sql`DELETE FROM approval_workflow_rule WHERE workflow_id = ${workflow.id}`;
  for (const [index, role] of roles.entries()) {
    await sql`
      INSERT INTO approval_workflow_rule (workflow_id, sequence, role, required_count, eligible_roles)
      VALUES (${workflow.id}, ${index + 1}, ${role}, 1, ARRAY[${role}]::text[])
    `;
  }

  return roles;
}

async function seedReviewer(
  reviewer: SeedReviewer,
): Promise<{ principalId: string; token: string }> {
  const [principal] = await sql<{ id: string }[]>`
    INSERT INTO app_principal (tenant_id, subject, display_name, email, auth_method, org_role)
    VALUES (${TENANT_ID}, ${reviewer.email}, ${reviewer.displayName}, ${reviewer.email},
            'MAGIC_LINK', 'REVIEWER')
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
  // What driving the reviewed path actually takes, end to end. `workspaces:read`
  // because a caller has to resolve the workspace it is acting in, and
  // `simulation:run` on the publisher because publishing is blocked until a
  // managed replay exists wherever the plan entitles bulk simulation -- a key
  // that can publish but cannot replay stops at a gate it cannot satisfy.
  const scopes = [
    "bundle:read",
    "workspaces:read",
    "approvals:read",
    "approvals:write",
    "policy:import",
    ...(reviewer.canPublish ? ["publish:write", "simulation:run"] : []),
  ];

  const label = `${reviewer.email}-key`;
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

  return { principalId: principal.id, token: rawToken };
}

/**
 * Publishes the keys as a new version of `KEYS_SECRET`, using the runtime
 * service account from the metadata server -- no client library, because this
 * image carries a Postgres driver and nothing else.
 */
async function publishKeys(body: string): Promise<void> {
  const tokenRes = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!tokenRes.ok) {
    throw new Error(`metadata server refused a token: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

  const res = await fetch(`https://secretmanager.googleapis.com/v1/${KEYS_SECRET}:addVersion`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ payload: { data: Buffer.from(body, "utf8").toString("base64") } }),
  });
  if (!res.ok) {
    throw new Error(`addVersion on ${KEYS_SECRET} failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  console.log(`Seeding reviewers in workspace ${WORKSPACE_ID} (tenant ${TENANT_ID})\n`);

  const roles = await seedApprovalWorkflow();
  console.log(`Approval workflow requires: ${roles.join(", ")}\n`);

  const envLines: string[] = [];
  const publicLines: string[] = [];

  for (const reviewer of REVIEWERS) {
    const { principalId, token } = await seedReviewer(reviewer);
    const idVar = reviewer.envVar.replace(/_TOKEN$/, "_PRINCIPAL_ID");
    const emailVar = reviewer.envVar.replace(/_TOKEN$/, "_EMAIL");

    envLines.push(`# ${reviewer.displayName} -- roles: ${reviewer.reviewerRoles.join(", ")}`);
    envLines.push(`${reviewer.envVar}=${token}`);
    envLines.push(`${idVar}=${principalId}`);
    envLines.push(`${emailVar}=${reviewer.email}`, "");

    // Everything except the key itself. Safe to log anywhere.
    publicLines.push(`${reviewer.displayName} -- roles: ${reviewer.reviewerRoles.join(", ")}`);
    publicLines.push(`  ${idVar}=${principalId}`);
    publicLines.push(`  ${emailVar}=${reviewer.email}`);
  }

  const body = `${envLines.join("\n")}\n`;

  if (!KEYS_SECRET) {
    // No secret store named, which is the local case: the operator's terminal
    // is where these belong.
    console.log(body);
    console.log("Copy the lines above into spctre-e2e/.env.");
    console.log(
      "\nThese are live bearer tokens. Re-running this seed deletes each key and\n" +
        "issues a new one, which is also how you rotate them.",
    );
    return;
  }

  // Written, never printed. If the write fails the run fails with it: the keys
  // exist in the database but nothing has seen them, and the next run replaces
  // both. Printing them as a fallback would defeat the point of the secret.
  await publishKeys(body);

  console.log(publicLines.join("\n"));
  console.log(`\nKeys written to ${KEYS_SECRET} (new version). Read them with:\n`);
  console.log(`  gcloud secrets versions access latest --secret=${KEYS_SECRET.split("/").pop()}\n`);
  console.log(
    "The output is env-file lines, so it appends straight into the e2e suite's\n" +
      "env file. Re-running this seed issues new keys and adds a new version,\n" +
      "which is also how you rotate them.",
  );
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed reviewers:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => sql.end());
