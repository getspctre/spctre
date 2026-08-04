import { randomBytes } from "crypto";
import type { RuntimePolicyContext } from "@spctre/policy-schema";
import { rawSql, runWithTenantContext, sql } from "@/lib/db";
import type { AuthSession } from "@/lib/auth-session";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import { issueAccessRefreshPair, type ServiceTokenScope } from "@/lib/service-tokens";
import { ensureStarterPublishedBundle, ONBOARDING_TTL_MINUTES, slugifyWorkspace } from "./shared";
import { recordConversionTelemetry } from "./telemetry";
import { swallow } from "@/lib/platform/swallow";

const DEV_TOKEN_SCOPES: ServiceTokenScope[] = [
  "bundle:read",
  "decision:evaluate",
  "evidence:write",
  "heartbeat:write",
];

export interface CliOnboardingStart {
  code: string;
  approveUrl: string;
  expiresAt: string;
}

export interface CliOnboardingExchange {
  token: string;
  tokenId: string;
  tokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tenantId: string;
  workspaceId: string;
  workspaceSlug: string;
  agentId: string;
  environment: string;
  bundlePath: string;
  artifactHash: string;
  branchId: string;
  revisionId: string;
  policyContext: RuntimePolicyContext[];
}

export async function startCliOnboarding(params: {
  controlPlaneUrl: string;
  workspaceSlug?: string;
  agentId: string;
  environment: string;
  bundlePath: string;
}): Promise<CliOnboardingStart> {
  if (!rawSql) throw new Error("Database not configured.");

  const code = randomBytes(8).toString("base64url");
  const expiresAt = new Date(Date.now() + ONBOARDING_TTL_MINUTES * 60 * 1000).toISOString();
  const baseUrl = params.controlPlaneUrl.replace(/\/+$/, "");

  await ensureDemoTenant();
  // The request is created before a browser approval identifies its tenant.
  // cli_onboarding_request is intentionally RLS-excluded for this exchange.
  await rawSql`
    INSERT INTO cli_onboarding_request (
      code, requested_workspace_slug, requested_agent_id,
      requested_environment, requested_bundle_path, control_plane_url, expires_at
    ) VALUES (
      ${code}, ${params.workspaceSlug ?? null}, ${params.agentId},
      ${params.environment}, ${params.bundlePath}, ${baseUrl}, ${expiresAt}
    )
  `;

  return {
    code,
    approveUrl: `${baseUrl}/onboarding/cli/approve?code=${encodeURIComponent(code)}`,
    expiresAt,
  };
}

export async function approveCliOnboardingRequest(params: {
  code: string;
  session: AuthSession;
}): Promise<{ ok: true; workspaceSlug: string } | { ok: false; error: string }> {
  if (!sql) return { ok: false, error: "Database not configured." };

  const requestRows = await sql<
    { requested_workspace_slug: string | null; requested_agent_id: string }[]
  >`
    SELECT requested_workspace_slug, requested_agent_id
    FROM cli_onboarding_request
    WHERE code = ${params.code}
      AND expires_at > now()
      AND exchanged_at IS NULL
    LIMIT 1
  `;
  const request = requestRows[0];
  if (!request) return { ok: false, error: "CLI onboarding request is expired or unknown." };

  const workspaceSlug =
    slugifyWorkspace(request.requested_workspace_slug ?? "default") || "default";
  const workspaceName =
    workspaceSlug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Default";

  const workspaceRows = await sql<{ id: string; slug: string }[]>`
    INSERT INTO workspace (tenant_id, slug, name)
    VALUES (${params.session.tenantId}, ${workspaceSlug}, ${workspaceName})
    ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, slug
  `;
  const workspace = workspaceRows[0];

  await sql`
    UPDATE cli_onboarding_request
    SET approved_by = ${params.session.principalId},
        approved_tenant_id = ${params.session.tenantId},
        approved_workspace_id = ${workspace.id}
    WHERE code = ${params.code}
      AND expires_at > now()
      AND exchanged_at IS NULL
  `;

  return { ok: true, workspaceSlug: workspace.slug };
}

export async function exchangeCliOnboardingCode(code: string): Promise<CliOnboardingExchange> {
  if (!rawSql || !sql) throw new Error("Database not configured.");

  // The opaque code is the sole pre-session capability. After resolving its
  // approved tenant, all tenant-scoped issuance below is explicitly bound.
  const requestRows = await rawSql<
    {
      id: string;
      requested_agent_id: string;
      requested_environment: string;
      requested_bundle_path: string;
      approved_tenant_id: string | null;
      approved_workspace_id: string | null;
      approved_by: string | null;
      trial: boolean;
    }[]
  >`
    SELECT
      id, requested_agent_id, requested_environment, requested_bundle_path,
      approved_tenant_id, approved_workspace_id, approved_by, trial
    FROM cli_onboarding_request
    WHERE code = ${code}
      AND expires_at > now()
      AND exchanged_at IS NULL
    LIMIT 1
  `;

  const request = requestRows[0];
  if (!request)
    throw new Error("CLI onboarding request is expired, unknown, or already exchanged.");
  if (!request.approved_tenant_id || !request.approved_workspace_id || !request.approved_by) {
    throw new Error("CLI onboarding request is waiting for browser approval.");
  }

  const approvedTenantId = request.approved_tenant_id;
  const approvedWorkspaceId = request.approved_workspace_id;
  const serviceSubject = `service:spctre-cli:${request.requested_agent_id}`;
  const serviceDisplayName = `Spctre CLI ${request.requested_agent_id}`;
  const exchange = await runWithTenantContext(approvedTenantId, () =>
    sql.begin(async (tx) => {
      const principalRows = await tx<{ id: string }[]>`
      INSERT INTO app_principal (tenant_id, subject, display_name, principal_type)
      VALUES (
        ${approvedTenantId}, ${serviceSubject}, ${serviceDisplayName}, 'SERVICE'
      )
      ON CONFLICT (tenant_id, subject) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `;
      const principalId = principalRows[0].id;

      await tx`
      INSERT INTO principal_permission_grant (
        tenant_id, principal_id, workspace_id, reviewer_roles, publish_scopes, allowed_environments
      ) VALUES (
        ${approvedTenantId}, ${principalId}, ${approvedWorkspaceId},
        ARRAY[]::text[], ARRAY[]::text[], ARRAY[${request.requested_environment}]::text[]
      )
      ON CONFLICT (principal_id, workspace_id) DO NOTHING
    `;

      const pair = await issueAccessRefreshPair(tx, {
        tenantId: approvedTenantId,
        workspaceId: approvedWorkspaceId,
        principalId,
        label: `Dev token for ${request.requested_agent_id}`,
        scopes: DEV_TOKEN_SCOPES,
        environment: request.requested_environment,
      });

      let billingCustomerId: string | undefined;

      if (request.trial) {
        // 1. Create or preserve a trial commercial profile without downgrading paid tenants.
        const existingProfile = await tx<
          { plan_code: string; billing_customer_id: string | null }[]
        >`
        SELECT plan_code, billing_customer_id FROM tenant_commercial_profile WHERE tenant_id = ${approvedTenantId} LIMIT 1
      `;
        const existingPlanCode = existingProfile[0]?.plan_code;
        if (existingPlanCode && existingPlanCode !== "HOSTED_TRIAL") {
          throw new Error(
            "This tenant already has a paid Spctre Cloud plan; use spctre cloud login without --trial.",
          );
        }
        billingCustomerId =
          existingProfile[0]?.billing_customer_id || `ctm_trial_${randomBytes(8).toString("hex")}`;
        await tx`
        INSERT INTO tenant_commercial_profile (
          tenant_id, plan_code, lifecycle_status, sales_status, billing_provider, billing_customer_id, updated_at
        ) VALUES (
          ${approvedTenantId}, 'HOSTED_TRIAL', 'EVALUATING', 'NONE', 'PADDLE', ${billingCustomerId}, now()
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          plan_code = 'HOSTED_TRIAL',
          billing_provider = 'PADDLE',
          billing_customer_id = coalesce(tenant_commercial_profile.billing_customer_id, EXCLUDED.billing_customer_id),
          updated_at = now()
      `;

        // 2. Set token and refresh token expiration dates to exactly 30 days from now
        const trialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await tx`
        UPDATE service_token
        SET expires_at = ${trialExpiresAt}
        WHERE id = ${pair.accessTokenId}
      `;
        await tx`
        UPDATE service_refresh_token
        SET expires_at = ${trialExpiresAt}
        WHERE access_token_id = ${pair.accessTokenId}
      `;
        pair.accessTokenExpiresAt = trialExpiresAt;
        pair.refreshTokenExpiresAt = trialExpiresAt;
      }

      await tx`
      UPDATE cli_onboarding_request
      SET exchanged_at = now(),
          service_principal_id = ${principalId},
          service_token_id = ${pair.accessTokenId}
      WHERE id = ${request.id}
        AND exchanged_at IS NULL
    `;

      // 3. Fire conversion telemetry (non-blocking)
      if (request.trial && billingCustomerId) {
        // Keep billing customer IDs in tenant_commercial_profile only; telemetry is aggregate-safe.
        await recordConversionTelemetry(approvedTenantId, "TRIAL_START", {
          billingProvider: "PADDLE",
          trialDurationDays: 30,
        }).catch(swallow("recordConversionTelemetry", undefined));
      }

      return { principalId, tokenId: pair.accessTokenId, pair };
    }),
  );
  const starter = await runWithTenantContext(approvedTenantId, () =>
    ensureStarterPublishedBundle({
      tenantId: approvedTenantId,
      workspaceId: approvedWorkspaceId,
      actorId: exchange.principalId,
      environment: request.requested_environment,
    }),
  );
  const workspaceRows = await runWithTenantContext(
    approvedTenantId,
    () =>
      sql<{ slug: string }[]>`
      SELECT slug
      FROM workspace
      WHERE tenant_id = ${approvedTenantId}
        AND id = ${approvedWorkspaceId}
      LIMIT 1
    `,
  );

  return {
    token: exchange.pair.accessToken,
    tokenId: exchange.tokenId,
    tokenExpiresAt: exchange.pair.accessTokenExpiresAt,
    refreshToken: exchange.pair.refreshToken,
    refreshTokenExpiresAt: exchange.pair.refreshTokenExpiresAt,
    tenantId: approvedTenantId,
    workspaceId: approvedWorkspaceId,
    workspaceSlug: workspaceRows[0]?.slug ?? "default",
    agentId: request.requested_agent_id,
    environment: request.requested_environment,
    bundlePath: request.requested_bundle_path,
    artifactHash: starter.artifactHash,
    branchId: starter.branchId,
    revisionId: starter.revisionId,
    policyContext: [
      {
        scope: "WORKSPACE",
        branchId: starter.branchId,
        revisionId: starter.revisionId,
        artifactHash: starter.artifactHash,
      },
    ],
  };
}
