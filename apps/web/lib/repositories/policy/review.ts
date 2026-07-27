import { sql } from "@/lib/db";
import {
  buildPolicyArtifactExport,
  composePolicyLayers,
  diffPolicyRules,
  toAgtCompatiblePolicyBundle,
  validateBundleCompatibility,
} from "@spctre/policy-schema";
import type {
  AgtCompatiblePolicyBundle,
  BundleCompatibilityReport,
  PolicyApproval,
  PolicyArtifactExport,
  PolicyCompositionPreview,
  PolicyRevisionDiff,
} from "@spctre/policy-schema";
import { listAdapterDeclarations } from "@/lib/repositories/packs";
import { listActiveCompositionLayers } from "@/lib/repositories/shared/composition";
import {
  getBaseRevisionId,
  getRevisionMetadata,
  stableHash,
} from "@/lib/repositories/shared/revisions";
import { listRulesForRevision } from "@/lib/repositories/shared/rules";

export interface ReviewArtifacts {
  composition: PolicyCompositionPreview;
  diff: PolicyRevisionDiff;
  artifact: PolicyArtifactExport;
  bundle: AgtCompatiblePolicyBundle;
}

export async function getApprovals(
  revisionId: string,
  tenantId: string
): Promise<PolicyApproval[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      reviewer_id: string;
      reviewer_name: string | null;
      reviewer_role: string;
      status: string;
      reviewed_at: Date | null;
    }[]
  >`
    SELECT
      pa.reviewer_id,
      p.display_name AS reviewer_name,
      pa.reviewer_role,
      pa.status,
      pa.reviewed_at
    FROM policy_approval pa
    LEFT JOIN app_principal p ON p.id::text = pa.reviewer_id AND p.tenant_id = pa.tenant_id
    WHERE pa.tenant_id = ${tenantId} AND pa.revision_id = ${revisionId}
  `;
  return rows.map((row) => ({
    reviewer: row.reviewer_name ?? row.reviewer_id,
    role: row.reviewer_role,
    status: row.status as PolicyApproval["status"],
    reviewedAt: row.reviewed_at?.toISOString()
  }));
}

export async function getApprovalById(
  approvalId: string,
  workspaceId: string | null,
  tenantId: string
): Promise<{
  id: string;
  reviewerId: string;
  reviewerRole: string;
  status: string;
  revisionId: string;
  reviewedAt: string | null;
  createdAt: string;
} | null> {
  if (!sql) return null;
  const rows = await sql<{
    id: string;
    reviewer_id: string;
    reviewer_role: string;
    status: string;
    revision_id: string;
    reviewed_at: Date | null;
    created_at: Date;
  }[]>`
    SELECT pa.id, pa.reviewer_id, pa.reviewer_role, pa.status, pa.revision_id, pa.reviewed_at, pa.created_at
    FROM policy_approval pa
    JOIN policy_branch pb ON pb.id = pa.branch_id AND pb.tenant_id = pa.tenant_id
    WHERE pa.tenant_id = ${tenantId}
      AND pa.id = ${approvalId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewerRole: row.reviewer_role,
    status: row.status,
    revisionId: row.revision_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getReviewArtifacts(
  branchId: string,
  revisionId: string,
  workspaceId: string | null,
  tenantId: string
): Promise<ReviewArtifacts | null> {
  if (!sql || !branchId || !revisionId) return null;

  const revision = await getRevisionMetadata(revisionId, tenantId);
  if (!revision) return null;

  const [layers, afterRules, beforeRevisionId, approvals] = await Promise.all([
    listActiveCompositionLayers(workspaceId, tenantId),
    listRulesForRevision(revisionId, tenantId),
    getBaseRevisionId(branchId, revisionId, tenantId),
    getApprovals(revisionId, tenantId)
  ]);

  if (!layers.length) return null;

  const beforeRules = beforeRevisionId ? await listRulesForRevision(beforeRevisionId, tenantId) : [];
  const generatedAt = new Date().toISOString();
  const composedArtifactHash = stableHash(
    JSON.stringify({
      branchId,
      revisionId,
      layers: layers.map((layer) => ({
        branchId: layer.branchId,
        revisionId: layer.revisionId,
        rules: layer.rules.map((rule) => rule.stableRuleId)
      }))
    })
  );
  const composition = composePolicyLayers({
    id: `cmp-${revisionId.slice(0, 8)}`,
    branchId,
    revisionId,
    layers,
    composedArtifactHash,
    composedAt: generatedAt
  });
  const artifactHash = revision.publishedArtifactHash ?? composition.composedArtifactHash;
  const targetStacks = revision.targetStacks.length
    ? revision.targetStacks
    : [{ stack: "CUSTOM" as const, adapter: "agt-compatible", environment: "production" }];
  const bundle = toAgtCompatiblePolicyBundle({
    tenantId,
      workspaceId,
    branchId,
    revisionId,
    sourceFormat: revision.sourceFormat,
    sourcePath: revision.sourcePath,
    sourceHash: revision.sourceHash,
    artifactHash,
    targetStacks,
    approvals,
    rules: composition.effectiveRules,
    generatedAt,
    sourceDocument: revision.sourceDocument,
    compatibility: revision.compatibility,
    metadata: {
      composed_artifact_hash: composition.composedArtifactHash,
      source_revision_rule_count: afterRules.length
    }
  });

  return {
    composition,
    diff: diffPolicyRules({
      branchId,
      baseRevisionId: beforeRevisionId ?? "initial",
      compareRevisionId: revisionId,
      before: beforeRules,
      after: afterRules
    }),
    artifact: buildPolicyArtifactExport({
      bundle,
      artifactHash,
      generatedAt
    }),
    bundle
  };
}

export async function upsertApprovalForRevision(params: {
  tenantId: string;
  revisionId: string;
  actorId: string;
  role: string;
  approvalStatus: string;
  note: string | null;
}): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  await sql`
    INSERT INTO policy_approval (
      tenant_id, workspace_id, branch_id, revision_id,
      reviewer_id, reviewer_role, status, note, reviewed_at
    )
    SELECT
      ${params.tenantId}, pr.workspace_id, pr.branch_id, ${params.revisionId},
      ${params.actorId}, ${params.role}, ${params.approvalStatus}, ${params.note}, now()
    FROM policy_revision pr
    WHERE pr.id = ${params.revisionId} AND pr.tenant_id = ${params.tenantId}
    ON CONFLICT (revision_id, reviewer_id) DO UPDATE SET
      status = EXCLUDED.status,
      note = EXCLUDED.note,
      reviewed_at = now()
  `;
}

export async function getBundleCompatibilityReport(
  bundle: AgtCompatiblePolicyBundle,
  workspaceId: string | null,
  tenantId: string
): Promise<BundleCompatibilityReport> {
  const adapters = await listAdapterDeclarations(workspaceId, tenantId).catch(() => []);
  return validateBundleCompatibility({ bundle, adapters });
}

export interface PendingApprovalBundle {
  branchId: string;
  branchName: string;
  workspaceId: string | null;
  scope: string;
  revisionId: string;
  revisionMessage: string;
  authorId: string;
  revisionCreatedAt: string;
  elapsedMs: number;
  approvals: Array<{
    reviewerId: string;
    reviewerRole: string;
    status: string;
    reviewedAt: string | null;
  }>;
}

export async function listPendingApprovalQueue(
  workspaceId: string | null,
  tenantId: string
): Promise<PendingApprovalBundle[]> {
  if (!sql) return [];

  const rows = await sql<{
    branch_id: string;
    branch_name: string;
    workspace_id: string | null;
    scope: string;
    revision_id: string;
    revision_message: string;
    author_id: string;
    revision_created_at: Date;
    reviewer_id: string | null;
    reviewer_role: string | null;
    approval_status: string | null;
    reviewed_at: Date | null;
  }[]>`
    SELECT
      pb.id AS branch_id,
      pb.name AS branch_name,
      pb.workspace_id,
      pb.scope,
      pb.active_revision_id AS revision_id,
      pr.message AS revision_message,
      pr.author_id,
      pr.created_at AS revision_created_at,
      pa.reviewer_id,
      pa.reviewer_role,
      pa.status AS approval_status,
      pa.reviewed_at
    FROM policy_branch pb
    JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
    LEFT JOIN policy_approval pa ON pa.revision_id = pb.active_revision_id AND pa.tenant_id = pb.tenant_id
    WHERE pb.tenant_id = ${tenantId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
      AND EXISTS (
        SELECT 1 FROM policy_approval pa2
        WHERE pa2.revision_id = pb.active_revision_id AND pa2.tenant_id = pb.tenant_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM policy_publish pp
        WHERE pp.revision_id = pb.active_revision_id AND pp.tenant_id = pb.tenant_id
      )
    ORDER BY pr.created_at ASC, pa.reviewer_id ASC
  `;

  const now = Date.now();
  const byBranch = new Map<string, PendingApprovalBundle>();
  for (const row of rows) {
    const existing = byBranch.get(row.branch_id) ?? {
      branchId: row.branch_id,
      branchName: row.branch_name,
      workspaceId: row.workspace_id,
      scope: row.scope,
      revisionId: row.revision_id,
      revisionMessage: row.revision_message,
      authorId: row.author_id,
      revisionCreatedAt: row.revision_created_at.toISOString(),
      elapsedMs: now - row.revision_created_at.getTime(),
      approvals: [],
    };
    if (row.reviewer_id && row.reviewer_role && row.approval_status) {
      existing.approvals.push({
        reviewerId: row.reviewer_id,
        reviewerRole: row.reviewer_role,
        status: row.approval_status,
        reviewedAt: row.reviewed_at?.toISOString() ?? null,
      });
    }
    byBranch.set(row.branch_id, existing);
  }
  return Array.from(byBranch.values());
}
