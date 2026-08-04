import { logger } from "@spctre/platform/logging";
import { rawSql, sql } from "@/lib/db";

type BundleExportOutcome = "PREVIEW" | "EXPORTED" | "BLOCKED" | "VERIFICATION_FAILED";

export interface BundleExportLogEntry {
  id: string;
  tenantId: string;
  workspaceId: string;
  branchId: string;
  revisionId: string;
  artifactHash: string;
  format: string;
  outcome: BundleExportOutcome;
  compiledArtifactHash?: string;
  blockingCount: number;
  verified: boolean | null;
  actorId?: string;
  createdAt: string;
}

export async function insertBundleExportLog(params: {
  tenantId: string;
  workspaceId: string;
  branchId: string;
  revisionId: string;
  artifactHash: string;
  format: string;
  outcome: "PREVIEW" | "EXPORTED" | "BLOCKED" | "VERIFICATION_FAILED";
  compiledArtifactHash: string | null;
  blockingCount: number;
  verified: boolean | null;
  actorId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO bundle_export_log
      (tenant_id, workspace_id, branch_id, revision_id, artifact_hash, format, outcome,
       compiled_artifact_hash, blocking_count, verified, actor_id)
    VALUES (
      ${params.tenantId},
      ${params.workspaceId},
      ${params.branchId},
      ${params.revisionId},
      ${params.artifactHash},
      ${params.format},
      ${params.outcome},
      ${params.compiledArtifactHash},
      ${params.blockingCount},
      ${params.verified},
      ${params.actorId}
    )
  `;
}

export async function listBundleExportLogs(params: {
  tenantId: string;
  workspaceId: string;
  revisionId?: string;
  format?: string;
  limit?: number;
  offset?: number;
}): Promise<BundleExportLogEntry[]> {
  if (!sql) return [];
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  try {
    const rows = await sql<
      {
        id: string;
        tenant_id: string;
        workspace_id: string;
        branch_id: string;
        revision_id: string;
        artifact_hash: string;
        format: string;
        outcome: BundleExportOutcome;
        compiled_artifact_hash: string | null;
        blocking_count: number;
        verified: boolean | null;
        actor_id: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, tenant_id, workspace_id, branch_id, revision_id, artifact_hash,
             format, outcome, compiled_artifact_hash, blocking_count, verified,
             actor_id, created_at
      FROM bundle_export_log
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        ${params.revisionId ? rawSql`AND revision_id = ${params.revisionId}` : rawSql``}
        ${params.format ? rawSql`AND format = ${params.format}` : rawSql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      branchId: row.branch_id,
      revisionId: row.revision_id,
      artifactHash: row.artifact_hash,
      format: row.format,
      outcome: row.outcome,
      compiledArtifactHash: row.compiled_artifact_hash ?? undefined,
      blockingCount: row.blocking_count,
      verified: row.verified,
      actorId: row.actor_id ?? undefined,
      createdAt: row.created_at.toISOString(),
    }));
  } catch (err) {
    logger.error("[listBundleExportLogs] failed:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
