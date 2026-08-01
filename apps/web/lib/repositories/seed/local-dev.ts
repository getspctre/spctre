// Demo-tenant seed orchestration entrypoint. The per-domain seed builders live
// in sibling modules (self-governance, trust, governance-telemetry); this file
// owns tenant/identity bootstrap, idempotent cleanup, and
// the ordered orchestration. Extracted domains in Phase 2 large-file split.
import { logger } from "@spctre/platform/logging";
import { DEMO_PRINCIPAL_IDS, DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "@/lib/demo";
import { runWithTenantContext, sql } from "@/lib/db";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { seedLocalDevSelfGovernancePack, rolloutProductionSelfGovernancePack } from "./self-governance";
import { seedTrustCalibrationPolicies, seedContextBudgetEvents, seedTrustScoreEvents } from "./trust";
import { resolveGovernancePackRefs, seedGatewayDecisionsAndEscalations, seedRuntimeEvidenceEvents, seedSimulationRuns } from "./governance-telemetry";

/** Demo seeding is automatic only outside production; hosted demos opt in explicitly. */
export function canBootstrapDemoTenant(): boolean {
  const config = getRuntimeConfig();
  return config.mode === "development" || config.demoTenantEnabled;
}

export async function ensureDemoTenant(): Promise<boolean> {
  if (!sql || !canBootstrapDemoTenant()) return false;
  await runWithTenantContext(DEMO_TENANT_ID, ensureDemoTenantInTenant);
  return true;
}

async function ensureDemoTenantInTenant(): Promise<void> {

  let blockedBySlugConflict = false;
  try {
    await sql.begin(async (tx) => {
      const conflictingTenant = await tx<{ id: string }[]>`
        SELECT id FROM tenant WHERE slug = 'tenant-demo' AND id != ${DEMO_TENANT_ID}
      `;
      if (conflictingTenant.length > 0) {
        blockedBySlugConflict = true;
        logger.warn("Demo tenant seed skipped because tenant-demo slug is already owned by another tenant", {
          existingTenantId: conflictingTenant[0].id,
          expectedTenantId: DEMO_TENANT_ID
        });
        return;
      }

      // Insert the demo tenant Organization if it doesn't exist by ID
      const existingTenant = await tx`
        SELECT id FROM tenant WHERE id = ${DEMO_TENANT_ID}
      `;
      if (existingTenant.length === 0) {
        await tx`
          INSERT INTO tenant (id, slug, name)
          VALUES (${DEMO_TENANT_ID}, 'tenant-demo', 'Demo Organization')
        `;
      }

      const conflictingWorkspace = await tx<{ id: string }[]>`
        SELECT id FROM workspace WHERE slug = 'workspace-demo' AND id != ${DEMO_WORKSPACE_ID}
      `;
      if (conflictingWorkspace.length > 0) {
        blockedBySlugConflict = true;
        logger.warn("Demo workspace seed skipped because workspace-demo slug is already owned by another workspace", {
          existingWorkspaceId: conflictingWorkspace[0].id,
          expectedWorkspaceId: DEMO_WORKSPACE_ID
        });
        return;
      }

      // Insert the demo workspace if it doesn't exist by ID
      const existingWorkspace = await tx`
        SELECT id FROM workspace WHERE id = ${DEMO_WORKSPACE_ID}
      `;
      if (existingWorkspace.length === 0) {
        await tx`
          INSERT INTO workspace (id, tenant_id, slug, name)
          VALUES (${DEMO_WORKSPACE_ID}, ${DEMO_TENANT_ID}, 'workspace-demo', 'Default Workspace')
        `;
      }
    });
    if (blockedBySlugConflict) return;
  } catch (err) {
    logger.error("Failed to seed core demo tenant and workspace", {
      error: err instanceof Error ? err.message : String(err)
    });
    return;
  }
  try {
    await sql`
      INSERT INTO app_principal (id, tenant_id, subject, display_name, email, principal_type, org_role, invite_status, invite_accepted_at)
      VALUES
        (${DEMO_PRINCIPAL_IDS.security}, ${DEMO_TENANT_ID}, 'maya-security', 'Maya Security', 'maya@spctre.local', 'USER', 'REVIEWER', 'ACCEPTED', now()),
        (${DEMO_PRINCIPAL_IDS.platform}, ${DEMO_TENANT_ID}, 'lee-platform', 'Lee Platform', 'lee@spctre.local', 'USER', 'REVIEWER', 'ACCEPTED', now()),
        (${DEMO_PRINCIPAL_IDS.owner}, ${DEMO_TENANT_ID}, 'nora-workspace-owner', 'Nora Workspace Owner', 'nora@spctre.local', 'USER', 'OWNER', 'ACCEPTED', now())
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO principal_permission_grant (
        tenant_id,
        principal_id,
        workspace_id,
        grant_role,
        reviewer_roles,
        publish_scopes,
        allowed_environments
      )
      VALUES
        (
          ${DEMO_TENANT_ID},
          ${DEMO_PRINCIPAL_IDS.security},
          NULL,
          'REVIEWER',
          ARRAY['Security','Legal']::text[],
          ARRAY['ORGANIZATION','WORKSPACE','ENVIRONMENT','CONNECTOR']::text[],
          ARRAY['production','staging','development','incident-mode']::text[]
        ),
        (
          ${DEMO_TENANT_ID},
          ${DEMO_PRINCIPAL_IDS.platform},
          NULL,
          'REVIEWER',
          ARRAY['Platform','Ops']::text[],
          ARRAY['WORKSPACE','ENVIRONMENT','CONNECTOR']::text[],
          ARRAY['development','staging','incident-mode']::text[]
        ),
        (
          ${DEMO_TENANT_ID},
          ${DEMO_PRINCIPAL_IDS.owner},
          ${DEMO_WORKSPACE_ID},
          'OWNER',
          ARRAY['Ops','Admin']::text[],
          ARRAY['WORKSPACE','CONNECTOR']::text[],
          ARRAY['development','staging']::text[]
        )
      ON CONFLICT (principal_id, workspace_id) DO NOTHING
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("relation") || !msg.includes("does not exist")) {
      logger.error("Identity/RBAC seeding failed", { error: msg });
    }
  }

  try {
    await seedLocalDevSelfGovernancePack();
    await rolloutProductionSelfGovernancePack();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("relation") || !msg.includes("does not exist")) {
      logger.error("Policy pack seeding failed", { error: msg });
    }
  }

  try {
    await seedDemoTelemetryAndGovernance();
  } catch (err) {
    logger.warn("Demo telemetry and governance seeding failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

async function seedDemoTelemetryAndGovernance() {
  if (!sql) return;

  await cleanDemoRecords();
  await seedTrustCalibrationPolicies();
  await seedContextBudgetEvents();
  await seedTrustScoreEvents();
  const packRefs = await resolveGovernancePackRefs();
  await seedGatewayDecisionsAndEscalations(packRefs);
  await seedRuntimeEvidenceEvents(packRefs);
  await seedSimulationRuns(packRefs);
}

// Delete existing demo records to ensure idempotency
async function cleanDemoRecords() {
  if (!sql) return;

  for (const deleteQuery of [
    async () => {
      const res = await sql`DELETE FROM context_budget_event WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned context_budget_event: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM agt_trust_score_event WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned agt_trust_score_event: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM runtime_evidence_event_key WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned runtime_evidence_event_key: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM runtime_evidence_event WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned runtime_evidence_event: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM gateway_escalation_queue WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned gateway_escalation_queue: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM gateway_decision WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned gateway_decision: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM agt_operations_log WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned agt_operations_log: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM trust_calibration_policy WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned trust_calibration_policy: ${res.count}`);
    },
    async () => {
      const res = await sql`DELETE FROM simulation_run WHERE tenant_id = ${DEMO_TENANT_ID}`;
      logger.info(`Cleaned simulation_run: ${res.count}`);
    },
  ]) {
    try {
      await deleteQuery();
    } catch (err) {
      logger.warn("Seeding cleanup failed for a table", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}
