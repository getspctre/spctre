import { sql } from "@/lib/db";
import { composePolicyLayers, toAgtCompatiblePolicyBundle } from "@spctre/policy-schema";
import type { AgtCompatiblePolicyBundle } from "@spctre/policy-schema";
import { listPublishedCompositionLayers } from "@/lib/repositories/shared/composition";
import { getRevisionMetadata, stableHash } from "@/lib/repositories/shared/revisions";
import { getApprovals } from "./review";

export interface PublishedBundle {
  publishId: string;
  publishedAt: string;
  publishedBy: string;
  branchId: string;
  revisionId: string;
  artifactHash: string;
  bundle: AgtCompatiblePolicyBundle;
}

export interface PublishedBundleSummary {
  workspaceId: string;
  publishId: string;
  publishedAt: string;
  publishedBy: string;
  branchId: string;
  revisionId: string;
  artifactHash: string;
}

export async function listLatestPublishedBundleSummariesForTenant(
  tenantId: string,
): Promise<Map<string, PublishedBundleSummary>> {
  if (!sql) return new Map();

  const rows = await sql<
    {
      workspace_id: string;
      publish_id: string;
      branch_id: string;
      revision_id: string;
      artifact_hash: string;
      published_by: string;
      published_at: Date;
    }[]
  >`
    WITH requested_workspace AS (
      SELECT id
      FROM workspace
      WHERE tenant_id = ${tenantId}
    )
    SELECT DISTINCT ON (rw.id)
      rw.id AS workspace_id,
      pp.id AS publish_id,
      pp.branch_id,
      pp.revision_id,
      pp.artifact_hash,
      pp.published_by,
      pp.published_at
    FROM requested_workspace rw
    JOIN policy_publish pp
      ON pp.tenant_id = ${tenantId}
    JOIN policy_branch pb
      ON pb.id = pp.branch_id
     AND pb.tenant_id = pp.tenant_id
    WHERE pp.workspace_id = rw.id
       OR pb.scope = 'ORGANIZATION'
    ORDER BY rw.id, pp.published_at DESC
  `;

  return new Map(
    rows.map((row) => [
      row.workspace_id,
      {
        workspaceId: row.workspace_id,
        publishId: row.publish_id,
        branchId: row.branch_id,
        revisionId: row.revision_id,
        artifactHash: row.artifact_hash,
        publishedBy: row.published_by,
        publishedAt: row.published_at.toISOString(),
      },
    ]),
  );
}

export async function getLatestPublishedBundle(
  workspaceId: string | null,
  tenantId: string,
): Promise<PublishedBundle | null> {
  if (!sql) return null;

  const rows = await sql<
    {
      publish_id: string;
      branch_id: string;
      revision_id: string;
      artifact_hash: string;
      published_by: string;
      published_at: Date;
    }[]
  >`
    SELECT
      pp.id AS publish_id,
      pp.branch_id,
      pp.revision_id,
      pp.artifact_hash,
      pp.published_by,
      pp.published_at
    FROM policy_publish pp
    JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
    WHERE pp.tenant_id = ${tenantId}
      AND (pp.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    ORDER BY pp.published_at DESC
    LIMIT 1
  `;

  const latest = rows[0];
  if (!latest) return null;

  const [revision, layers, approvals] = await Promise.all([
    getRevisionMetadata(latest.revision_id, tenantId),
    listPublishedCompositionLayers(workspaceId, tenantId),
    getApprovals(latest.revision_id, tenantId),
  ]);

  if (!revision || !layers.length) return null;

  const generatedAt = new Date().toISOString();
  const composition = composePolicyLayers({
    id: `pub-${latest.revision_id.slice(0, 8)}`,
    branchId: latest.branch_id,
    revisionId: latest.revision_id,
    layers,
    composedArtifactHash: stableHash(
      JSON.stringify({
        publishId: latest.publish_id,
        revisionId: latest.revision_id,
        artifactHash: latest.artifact_hash,
        layers: layers.map((layer) => ({
          branchId: layer.branchId,
          revisionId: layer.revisionId,
          artifactHash: layer.artifactHash,
          rules: layer.rules.map((rule) => rule.stableRuleId),
        })),
      }),
    ),
    composedAt: generatedAt,
  });

  const targetStacks = revision.targetStacks.length
    ? revision.targetStacks
    : [{ stack: "CUSTOM" as const, adapter: "agt-compatible", environment: "production" }];

  return {
    publishId: latest.publish_id,
    publishedAt: latest.published_at.toISOString(),
    publishedBy: latest.published_by,
    branchId: latest.branch_id,
    revisionId: latest.revision_id,
    artifactHash: latest.artifact_hash,
    bundle: toAgtCompatiblePolicyBundle({
      tenantId,
      workspaceId,
      branchId: latest.branch_id,
      revisionId: latest.revision_id,
      sourceFormat: revision.sourceFormat,
      sourcePath: revision.sourcePath,
      sourceHash: revision.sourceHash,
      artifactHash: latest.artifact_hash,
      targetStacks,
      approvals,
      rules: composition.effectiveRules,
      generatedAt,
      sourceDocument: revision.sourceDocument,
      compatibility: revision.compatibility,
      metadata: {
        composed_artifact_hash: composition.composedArtifactHash,
        published_layer_count: layers.length,
        conflict_notes: composition.conflictNotes,
        publish_id: latest.publish_id,
        published_at: latest.published_at.toISOString(),
        published_by: latest.published_by,
      },
    }),
  };
}

/**
 * Resolves a policy branch by NAME to its currently-published revision. Returns
 * the branch id and the most-recently-published revision id, or null when the
 * branch does not exist or has no published revision. Used by the Blueprint
 * import to fail closed unless a governing policy is already published.
 */
export async function getPublishedPolicyBranchByName(params: {
  tenantId: string;
  workspaceId: string;
  branchName: string;
}): Promise<{ branchId: string; revisionId: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ branch_id: string; revision_id: string }[]>`
    SELECT pp.branch_id, pp.revision_id
    FROM policy_publish pp
    JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
    WHERE pp.tenant_id = ${params.tenantId}
      AND pb.name = ${params.branchName}
      AND (pb.workspace_id = ${params.workspaceId} OR pb.scope = 'ORGANIZATION')
    ORDER BY pp.published_at DESC
    LIMIT 1
  `;
  return rows[0] ? { branchId: rows[0].branch_id, revisionId: rows[0].revision_id } : null;
}

export async function getExistingPublishArtifactHash(params: {
  tenantId: string;
  branchId: string;
  revisionId: string;
}): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ artifact_hash: string }[]>`
    SELECT artifact_hash
    FROM policy_publish
    WHERE tenant_id = ${params.tenantId}
      AND branch_id = ${params.branchId}
      AND revision_id = ${params.revisionId}
      AND environment = 'production'
      AND runtime_stack = 'CUSTOM'
    ORDER BY published_at DESC
    LIMIT 1
  `;
  return rows[0]?.artifact_hash ?? null;
}

export async function insertPolicyPublish(params: {
  tenantId: string;
  branchId: string;
  revisionId: string;
  artifactHash: string;
  actorId: string;
}): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  await sql`
    INSERT INTO policy_publish (
      tenant_id, workspace_id, branch_id, revision_id,
      environment, runtime_stack, artifact_hash, published_by
    )
    SELECT
      ${params.tenantId}, pb.workspace_id, ${params.branchId}, ${params.revisionId},
      'production', 'CUSTOM', ${params.artifactHash}, ${params.actorId}
    FROM policy_branch pb
    WHERE pb.tenant_id = ${params.tenantId} AND pb.id = ${params.branchId}
  `;
}

export async function publishRollbackAndActivate(params: {
  tenantId: string;
  branchId: string;
  targetRevisionId: string;
  artifactHash: string;
  actorId: string;
}): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_publish (
        tenant_id, workspace_id, branch_id, revision_id,
        environment, runtime_stack, artifact_hash, published_by
      )
      SELECT
        ${params.tenantId}, pb.workspace_id, ${params.branchId}, ${params.targetRevisionId},
        'production', 'CUSTOM', ${params.artifactHash}, ${params.actorId}
      FROM policy_branch pb
      WHERE pb.tenant_id = ${params.tenantId} AND pb.id = ${params.branchId}
    `;
    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${params.targetRevisionId}
      WHERE id = ${params.branchId} AND tenant_id = ${params.tenantId}
    `;
  });
}
