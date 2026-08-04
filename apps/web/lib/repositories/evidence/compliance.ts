import { sql } from "@/lib/db";

export interface PublishedRevisionRow {
  publish_id: string;
  branch_id: string;
  revision_id: string;
  artifact_hash: string;
  published_by: string;
  published_at: Date;
  source_format: string;
  source_hash: string;
  target_stacks: unknown;
  author_id: string;
  message: string;
  revision_created_at: Date;
}

export async function getLatestPublishAndRevision(
  workspaceId: string | null,
  tenantId: string,
): Promise<PublishedRevisionRow | null> {
  if (!sql) return null;

  const rows = await sql<PublishedRevisionRow[]>`
    SELECT
      pp.id AS publish_id,
      pp.branch_id,
      pp.revision_id,
      pp.artifact_hash,
      pp.published_by,
      pp.published_at,
      pr.source_format,
      pr.source_hash,
      pr.target_stacks,
      pr.author_id,
      pr.message,
      pr.created_at AS revision_created_at
    FROM policy_publish pp
    JOIN policy_revision pr ON pr.id = pp.revision_id
    JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
    WHERE pp.tenant_id = ${tenantId}
      AND (pp.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    ORDER BY pp.published_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export interface EvidenceErasureFilters {
  decisionIds?: string[];
  agentId?: string;
  before?: string;
}

// GDPR Art. 17 erasure: tombstones PII-bearing content in place instead of
// deleting rows. evidence_content_hash / evidence_prev_hash are deliberately
// left untouched so hash-chain linkage stays intact; rows with erased_at set
// are exempt from content re-verification by contract (migration 056).
export async function eraseEvidencePiiEvents(
  tenantId: string,
  workspaceId: string | null,
  filters: EvidenceErasureFilters,
  erasedBy: string,
): Promise<{ erasedDecisionIds: string[] }> {
  if (!sql) return { erasedDecisionIds: [] };
  if (!filters.decisionIds?.length && !filters.agentId && !filters.before) {
    return { erasedDecisionIds: [] };
  }

  const tombstone = JSON.stringify({
    _erased: true,
    _erasedAt: new Date().toISOString(),
    _erasedBy: erasedBy,
  });

  const decisionIds = filters.decisionIds?.length ? filters.decisionIds : null;
  const agentId = filters.agentId ?? null;
  const before = filters.before ?? null;

  const erased = await sql.begin(async (tx) => {
    const rows = await tx<{ decision_id: string }[]>`
      UPDATE runtime_evidence_event
      SET raw_evidence = ${tombstone}::jsonb,
          execution_trace = NULL,
          reason = '[ERASED]',
          erased_at = now(),
          erased_by = ${erasedBy}
      WHERE tenant_id = ${tenantId}
        AND erased_at IS NULL
        AND (${workspaceId}::uuid IS NULL OR workspace_id = ${workspaceId}::uuid)
        AND (${decisionIds}::text[] IS NULL OR decision_id = ANY(${decisionIds}::text[]))
        AND (${agentId}::text IS NULL OR agent_id = ${agentId}::text)
        AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
      RETURNING decision_id
    `;

    if (rows.length > 0) {
      await tx`
        UPDATE gateway_decision
        SET tool_intent = NULL,
            plan_summary = NULL,
            tool_parameters = NULL
        WHERE tenant_id = ${tenantId}
          AND (${workspaceId}::uuid IS NULL OR workspace_id = ${workspaceId}::uuid)
          AND decision_id = ANY(${rows.map((row) => row.decision_id)})
      `;
    }

    return rows;
  });

  return { erasedDecisionIds: erased.map((r) => r.decision_id) };
}

export async function deleteExpiredEvidenceEvents(
  tenantId: string,
  workspaceId: string | null,
  expiredIds: string[],
): Promise<string[]> {
  if (!sql || !expiredIds.length) return [];

  const deleted = await sql.begin(async (tx) => {
    const rows = await tx<{ decision_id: string }[]>`
      DELETE FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND decision_id = ANY(${expiredIds})
      RETURNING decision_id
    `;
    if (rows.length > 0) {
      await tx`
        DELETE FROM runtime_evidence_event_key
        WHERE tenant_id = ${tenantId}
          AND decision_id = ANY(${rows.map((row) => row.decision_id)})
      `;
    }
    return rows;
  });

  return deleted.map((r) => r.decision_id);
}
