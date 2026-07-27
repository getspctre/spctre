import { randomUUID } from "crypto";
import { computeShortHash } from "@spctre/platform";
import { getPackMetadata, packToDocument, parseAgtPolicyDocument, POLICY_PACKS } from "@spctre/policy-schema";
import { DEMO_TENANT_ID } from "@/lib/demo";
import { sql } from "@/lib/db";

const ADVISOR_GOVERNANCE_BASELINE_PACK_ID = "spctre-agent-governance-v1";
const ADVISOR_GOVERNANCE_BASELINE_ENVIRONMENT = "production";
const ADVISOR_GOVERNANCE_BASELINE_RUNTIME_STACK = "CUSTOM";

type DefaultPack = (typeof POLICY_PACKS)[number];

function buildDefaultPackSourceDocument(
  pack: DefaultPack,
  packMetadata: ReturnType<typeof getPackMetadata>,
  parsed: ReturnType<typeof parseAgtPolicyDocument>
) {
  return {
    ...(parsed.sourceDocument ?? {}),
    metadata: {
      ...pack.metadata,
      spctre_pack: {
        packId: pack.id,
        connector: pack.connector,
        version: packMetadata.version,
        owner: packMetadata.owner,
        reviewRoles: packMetadata.reviewRoles,
        minimumApprovals: packMetadata.minimumApprovals,
        compatibilityTargets: packMetadata.compatibilityTargets,
        installedAs: "advisor_governance_baseline",
      },
    },
    spctre_agt_compatibility: parsed.compatibility,
  };
}

export async function ensureDefaultPublishedPolicyPack(params: {
  tenantId: string;
  workspaceId: string;
  actorId: string;
}): Promise<{ branchId: string; revisionId: string; artifactHash: string } | null> {
  if (!sql || params.tenantId === DEMO_TENANT_ID) return null;

  const pack = POLICY_PACKS.find((candidate) => candidate.id === ADVISOR_GOVERNANCE_BASELINE_PACK_ID);
  if (!pack) return null;

  const packMetadata = getPackMetadata(pack);
  const source = packToDocument(pack);
  const sourcePath = `packs/${pack.id}.json`;
  const parsed = parseAgtPolicyDocument({ document: source, sourcePath });
  const sourceDocument = buildDefaultPackSourceDocument(pack, packMetadata, parsed);
  const sourceHash = computeShortHash(source);

  let installed: { branchId: string; revisionId: string; artifactHash: string } | null = null;

  await sql.begin(async (tx) => {
    const branchRows = await tx<{ id: string; active_revision_id: string | null }[]>`
      SELECT id, active_revision_id
      FROM policy_branch
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND scope = 'CONNECTOR'
        AND connector = ${pack.connector}
        AND name = ${pack.connector}
      LIMIT 1
    `;

    let branchId = branchRows[0]?.id;
    if (!branchId) {
      const insertedBranchRows = await tx<{ id: string }[]>`
        INSERT INTO policy_branch (
          tenant_id, workspace_id, scope, environment, connector, name, created_by
        ) VALUES (
          ${params.tenantId}, ${params.workspaceId},
          'CONNECTOR', null, ${pack.connector}, ${pack.connector}, ${params.actorId}
        )
        RETURNING id
      `;
      branchId = insertedBranchRows[0]?.id;
    }
    if (!branchId) return;

    let revisionId = branchRows[0]?.active_revision_id;
    let artifactHash: string | null = null;

    if (revisionId) {
      const revisionRows = await tx<{ artifact_hash: string | null }[]>`
        SELECT artifact_hash
        FROM policy_revision
        WHERE tenant_id = ${params.tenantId}
          AND workspace_id = ${params.workspaceId}
          AND branch_id = ${branchId}
          AND id = ${revisionId}
        LIMIT 1
      `;
      artifactHash = revisionRows[0]?.artifact_hash ?? null;
    } else {
      revisionId = randomUUID();
      artifactHash = computeShortHash(
        `${params.tenantId}:${params.workspaceId}:${pack.id}:${packMetadata.version}:${revisionId}`
      );

      await tx`
        INSERT INTO policy_revision (
          id, tenant_id, workspace_id, branch_id,
          source_format, source_path, source_document, source_hash, artifact_hash,
          author_id, message, target_stacks
        ) VALUES (
          ${revisionId}, ${params.tenantId}, ${params.workspaceId}, ${branchId},
          'AGT_YAML', ${sourcePath}, ${JSON.stringify(sourceDocument)}::jsonb,
          ${sourceHash}, ${artifactHash}, ${params.actorId},
          ${`Install ${pack.name} v${packMetadata.version}`},
          ${JSON.stringify([
            {
              stack: ADVISOR_GOVERNANCE_BASELINE_RUNTIME_STACK,
              adapter: "spctre-control-plane",
              environment: ADVISOR_GOVERNANCE_BASELINE_ENVIRONMENT,
            },
          ])}::jsonb
        )
      `;

      if (parsed.rules.length > 0) {
        await tx`INSERT INTO policy_rule ${tx(
          parsed.rules.map((rule) => ({
            tenant_id: params.tenantId,
            workspace_id: params.workspaceId,
            branch_id: branchId,
            revision_id: revisionId,
            stable_rule_id: rule.stableRuleId,
            title: rule.title,
            effect: rule.effect,
            source_path: rule.sourcePath ?? sourcePath,
            domains: rule.domains ?? [],
            connectors: rule.connectors ?? [],
            actions: rule.actions ?? [],
            immutable: rule.immutable ?? false,
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
          "immutable"
        )}`;
      }

      await tx`
        UPDATE policy_branch
        SET active_revision_id = ${revisionId}
        WHERE id = ${branchId}
          AND tenant_id = ${params.tenantId}
      `;
    }

    artifactHash =
      artifactHash ??
      computeShortHash(`${params.tenantId}:${params.workspaceId}:${pack.id}:${packMetadata.version}:${revisionId}`);

    await tx`
      INSERT INTO policy_publish (
        tenant_id, workspace_id, branch_id, revision_id,
        environment, runtime_stack, runtime_adapter, artifact_hash, published_by
      )
      SELECT
        ${params.tenantId}, ${params.workspaceId}, ${branchId}, ${revisionId},
        ${ADVISOR_GOVERNANCE_BASELINE_ENVIRONMENT}, ${ADVISOR_GOVERNANCE_BASELINE_RUNTIME_STACK}, 'spctre-control-plane',
        ${artifactHash}, ${params.actorId}
      WHERE NOT EXISTS (
        SELECT 1
        FROM policy_publish
        WHERE tenant_id = ${params.tenantId}
          AND workspace_id = ${params.workspaceId}
          AND branch_id = ${branchId}
          AND revision_id = ${revisionId}
          AND environment = ${ADVISOR_GOVERNANCE_BASELINE_ENVIRONMENT}
          AND runtime_stack = ${ADVISOR_GOVERNANCE_BASELINE_RUNTIME_STACK}
          AND runtime_adapter = 'spctre-control-plane'
      )
    `;

    installed = { branchId, revisionId, artifactHash };
  });

  return installed;
}
