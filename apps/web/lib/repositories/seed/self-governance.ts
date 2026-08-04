// Self-governance policy pack seeding (local-dev + production rollout).
// Extracted from local-dev.ts (Phase 2 large-file split).
import { randomUUID } from "crypto";
import type { JSONValue } from "postgres";
import { computeShortHash } from "@spctre/platform";
import { POLICY_PACKS } from "@spctre/policy-schema";
import { DEMO_PRINCIPAL_IDS, DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "@/lib/demo";
import { sql } from "@/lib/db";

const LOCAL_DEV_SELF_GOVERNANCE_PACK_ID = "spctre-agent-governance-v1";
const LOCAL_DEV_SELF_GOVERNANCE_ACTOR = "seed:local-dev";
const LOCAL_DEV_SELF_GOVERNANCE_ENVIRONMENT = "development";
const LOCAL_DEV_SELF_GOVERNANCE_ADAPTER = "spctre-local-dev";
const PRODUCTION_SELF_GOVERNANCE_ENVIRONMENT = "production";
const PRODUCTION_SELF_GOVERNANCE_ADAPTER = "spctre-control-plane";

interface SelfGovernancePackInstall {
  branchId: string;
  revisionId: string;
  artifactHash: string;
}

async function ensureSelfGovernancePackRevision(): Promise<SelfGovernancePackInstall | null> {
  const pack = POLICY_PACKS.find((candidate) => candidate.id === LOCAL_DEV_SELF_GOVERNANCE_PACK_ID);
  if (!pack || !sql) return null;

  const artifactHash = computeShortHash(
    `${DEMO_TENANT_ID}:${DEMO_WORKSPACE_ID}:${pack.id}:${pack.metadata.version ?? "1.0.0"}`,
  );

  const existingRows = await sql<
    { id: string; active_revision_id: string | null; artifact_hash: string | null }[]
  >`
    SELECT pb.id, pb.active_revision_id, pr.artifact_hash
    FROM policy_branch pb
    LEFT JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
    WHERE pb.tenant_id = ${DEMO_TENANT_ID}
      AND pb.workspace_id = ${DEMO_WORKSPACE_ID}
      AND pb.scope = 'CONNECTOR'
      AND pb.connector = ${pack.connector}
      AND pb.name = ${pack.connector}
    LIMIT 1
  `;

  const activeRevisionId = existingRows[0]?.active_revision_id;
  if (activeRevisionId) {
    const installedRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM policy_rule
      WHERE tenant_id = ${DEMO_TENANT_ID}
        AND workspace_id = ${DEMO_WORKSPACE_ID}
        AND revision_id = ${activeRevisionId}
        AND stable_rule_id = ${pack.rules[0]?.stableRuleId ?? ""}
    `;
    if (Number.parseInt(installedRows[0]?.count ?? "0", 10) > 0) {
      return {
        branchId: existingRows[0].id,
        revisionId: activeRevisionId,
        artifactHash: existingRows[0].artifact_hash ?? artifactHash,
      };
    }
  }

  const sourceDocument = {
    metadata: pack.metadata,
    rules: pack.rules.map((rule) => ({
      stable_rule_id: rule.stableRuleId,
      title: rule.title,
      effect: rule.effect,
      domains: rule.domains,
      connectors: rule.connectors,
      actions: rule.actions,
      immutable: rule.immutable,
    })),
  };
  const source = JSON.stringify(sourceDocument, null, 2);
  const sourceHash = computeShortHash(source);
  let install: SelfGovernancePackInstall | null = null;

  await sql.begin(async (tx) => {
    let branchId = existingRows[0]?.id;
    if (!branchId) {
      const branchRows = await tx<{ id: string }[]>`
        INSERT INTO policy_branch (
          tenant_id, workspace_id, scope, environment, connector, name, created_by
        ) VALUES (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID},
          'CONNECTOR', null, ${pack.connector}, ${pack.connector}, ${LOCAL_DEV_SELF_GOVERNANCE_ACTOR}
        )
        RETURNING id
      `;
      branchId = branchRows[0].id;
    }

    const revisionId = randomUUID();

    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id,
        source_format, source_path, source_document, source_hash, artifact_hash,
        author_id, message, target_stacks
      ) VALUES (
        ${revisionId}, ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${branchId},
        'AGT_YAML', ${`packs/${pack.id}.json`}, ${sql.json(sourceDocument as JSONValue)}::jsonb,
        ${sourceHash}, ${artifactHash}, ${LOCAL_DEV_SELF_GOVERNANCE_ACTOR},
        ${`Seed ${pack.name} v${pack.metadata.version ?? "1.0.0"} for local dev`},
        ${sql.json([
          {
            stack: "LOCAL",
            adapter: LOCAL_DEV_SELF_GOVERNANCE_ADAPTER,
            environment: LOCAL_DEV_SELF_GOVERNANCE_ENVIRONMENT,
          },
          {
            stack: "CUSTOM",
            adapter: PRODUCTION_SELF_GOVERNANCE_ADAPTER,
            environment: PRODUCTION_SELF_GOVERNANCE_ENVIRONMENT,
          },
        ] as JSONValue)}::jsonb
      )
    `;

    await tx`INSERT INTO policy_rule ${tx(
      pack.rules.map((rule) => ({
        tenant_id: DEMO_TENANT_ID,
        workspace_id: DEMO_WORKSPACE_ID,
        branch_id: branchId,
        revision_id: revisionId,
        stable_rule_id: rule.stableRuleId,
        title: rule.title,
        effect: rule.effect,
        source_path: `packs/${pack.id}.json`,
        domains: rule.domains,
        connectors: rule.connectors,
        actions: rule.actions,
        immutable: rule.immutable,
      })),
      "tenant_id",
      "workspace_id",
      "branch_id",
      "revision_id",
      "stable_rule_id",
      "title",
      "effect",
      "source_path",
      "domains",
      "connectors",
      "actions",
      "immutable",
    )}`;

    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${revisionId}
      WHERE id = ${branchId}
    `;
    install = { branchId, revisionId, artifactHash };
  });

  return install;
}

export async function seedLocalDevSelfGovernancePack() {
  if (!sql) return;

  const install = await ensureSelfGovernancePackRevision();
  if (!install) return;

  const result = await sql`
    INSERT INTO policy_publish (
      tenant_id, workspace_id, branch_id, revision_id,
      environment, runtime_stack, runtime_adapter, artifact_hash, published_by
    )
    SELECT
      ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${install.branchId}, ${install.revisionId},
      ${LOCAL_DEV_SELF_GOVERNANCE_ENVIRONMENT}, 'LOCAL', ${LOCAL_DEV_SELF_GOVERNANCE_ADAPTER},
      ${install.artifactHash}, ${LOCAL_DEV_SELF_GOVERNANCE_ACTOR}
    WHERE NOT EXISTS (
      SELECT 1 FROM policy_publish
      WHERE tenant_id = ${DEMO_TENANT_ID}
        AND workspace_id = ${DEMO_WORKSPACE_ID}
        AND branch_id = ${install.branchId}
        AND revision_id = ${install.revisionId}
        AND environment = ${LOCAL_DEV_SELF_GOVERNANCE_ENVIRONMENT}
        AND runtime_adapter = ${LOCAL_DEV_SELF_GOVERNANCE_ADAPTER}
    )
  `;
}

export async function rolloutProductionSelfGovernancePack() {
  if (!sql) return;

  const install = await ensureSelfGovernancePackRevision();
  if (!install) return;

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_approval (
        tenant_id, workspace_id, branch_id, revision_id,
        reviewer_id, reviewer_role, status, note, reviewed_at
      )
      VALUES
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${install.branchId}, ${install.revisionId},
          ${DEMO_PRINCIPAL_IDS.security}, 'Security', 'APPROVED',
          'Production rollout approval for spctre-agent-governance-v1.', now()
        ),
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${install.branchId}, ${install.revisionId},
          ${DEMO_PRINCIPAL_IDS.platform}, 'Platform', 'APPROVED',
          'Production rollout approval for spctre-agent-governance-v1.', now()
        )
      ON CONFLICT (revision_id, reviewer_id)
      DO UPDATE SET
        status = 'APPROVED',
        note = EXCLUDED.note,
        reviewed_at = COALESCE(policy_approval.reviewed_at, EXCLUDED.reviewed_at)
    `;

    const publishResult = await tx`
      INSERT INTO policy_publish (
        tenant_id, workspace_id, branch_id, revision_id,
        environment, runtime_stack, runtime_adapter, artifact_hash, published_by
      )
      SELECT
        ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${install.branchId}, ${install.revisionId},
        ${PRODUCTION_SELF_GOVERNANCE_ENVIRONMENT}, 'CUSTOM', ${PRODUCTION_SELF_GOVERNANCE_ADAPTER},
        ${install.artifactHash}, ${DEMO_PRINCIPAL_IDS.security}
      WHERE NOT EXISTS (
        SELECT 1 FROM policy_publish
        WHERE tenant_id = ${DEMO_TENANT_ID}
          AND workspace_id = ${DEMO_WORKSPACE_ID}
          AND branch_id = ${install.branchId}
          AND revision_id = ${install.revisionId}
          AND environment = ${PRODUCTION_SELF_GOVERNANCE_ENVIRONMENT}
          AND runtime_adapter = ${PRODUCTION_SELF_GOVERNANCE_ADAPTER}
      )
    `;
  });
}
