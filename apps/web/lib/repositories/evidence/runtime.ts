import { logger } from "@spctre/platform/logging";
import { createHash } from "node:crypto";
import type { JSONValue } from "postgres";
import { sql, rawSql } from "@/lib/db";
import type { KeysetCursor } from "@/lib/pagination/keyset";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import type {
  RuntimeDecisionEvidenceRecord,
  RuntimePolicyContext,
  RuntimeStack,
} from "@spctre/policy-schema";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { archivalService } from "@/lib/ee-adapters/archival";
import { getCommercialProfile } from "@/lib/repositories/workspace";

export async function countRuntimeEvidence(
  workspaceId: string | null,
  tenantId: string,
): Promise<number> {
  if (!sql) return 0;
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM runtime_evidence_event event
    JOIN runtime_evidence_event_key event_key
      ON event_key.tenant_id = event.tenant_id
     AND event_key.decision_id = event.decision_id
     AND event_key.evidence_event_id = event.id
    WHERE event.tenant_id = ${tenantId}
      AND event.workspace_id = ${workspaceId}
  `;
  return parseInt(rows[0]?.count ?? "0", 10);
}

type RuntimeEvidenceRow = {
  decision_id: string;
  tenant_id: string;
  workspace_id: string;
  environment: string;
  runtime_stack: string;
  runtime_adapter: string | null;
  agent_id: string;
  connector: string;
  action: string;
  status: string;
  reason: string;
  policy_refs: string[];
  artifact_hash: string;
  policy_context: unknown;
  raw_evidence: unknown;
  latency_ms: number | null;
  created_at: Date;
};

type RevisionPackMetadata = {
  packId?: string;
  packVersion?: string;
  packOwner?: string;
  branchName?: string;
  revisionAuthorId?: string;
  revisionCreatedAt?: string;
  approvalCount?: number;
  approverIds?: string[];
  publishedAt?: string;
  publishedBy?: string;
};

type RevisionMetadataRow = {
  revision_id: string;
  branch_name: string | null;
  author_id: string | null;
  revision_created_at: Date | null;
  approval_count: string | null;
  approver_ids: string[] | null;
  published_at: Date | null;
  published_by: string | null;
  source_document: unknown;
};

export async function listRuntimeEvidence(
  workspaceId: string | null,
  tenantId: string,
  limit = 50,
  offset = 0,
): Promise<RuntimeDecisionEvidenceRecord[]> {
  if (!sql) return [];
  const rows = await sql<RuntimeEvidenceRow[]>`
    SELECT
      decision_id, tenant_id, workspace_id, environment,
      runtime_stack, runtime_adapter, agent_id, connector, action,
      status, reason, policy_refs, artifact_hash, policy_context,
      raw_evidence, latency_ms, created_at
    FROM runtime_evidence_event
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const packByRevisionId = await loadRevisionPackMetadata(
    tenantId,
    revisionIdsFromEvidenceRows(rows),
  );
  return rows.map((row) => mapRuntimeEvidenceRow(row, packByRevisionId));
}

/**
 * Connector-scoped evidence retrieval for a service-token principal. Revision
 * and time grants are applied by the evidence domain after the persisted token
 * identity has been resolved; callers never provide a connector selector.
 */
export async function listRuntimeEvidenceForConnector(
  workspaceId: string,
  tenantId: string,
  connector: string,
  limit = 5000,
): Promise<RuntimeDecisionEvidenceRecord[]> {
  if (!sql) return [];
  const rows = await sql<RuntimeEvidenceRow[]>`
    SELECT
      decision_id, tenant_id, workspace_id, environment,
      runtime_stack, runtime_adapter, agent_id, connector, action,
      status, reason, policy_refs, artifact_hash, policy_context,
      raw_evidence, latency_ms, created_at
    FROM runtime_evidence_event
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND connector = ${connector}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 5000)}
  `;
  const packByRevisionId = await loadRevisionPackMetadata(
    tenantId,
    revisionIdsFromEvidenceRows(rows),
  );
  return rows.map((row) => mapRuntimeEvidenceRow(row, packByRevisionId));
}

// Distinct connector/action pairs seen in retained evidence, for the rule
// builder's "connector/action from observed evidence" vocabulary. Capped and
// ordered so the newest-active surfaces first.
export async function listObservedConnectorActions(
  workspaceId: string | null,
  tenantId: string,
  limit = 200,
): Promise<{ connector: string; action: string }[]> {
  if (!sql) return [];
  const rows = await sql<{ connector: string; action: string }[]>`
    SELECT connector, action
    FROM runtime_evidence_event
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND connector <> ''
      AND action <> ''
    GROUP BY connector, action
    ORDER BY MAX(created_at) DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `;
  return rows.map((row) => ({ connector: row.connector, action: row.action }));
}

export interface RuntimeEvidenceKeysetRow {
  record: RuntimeDecisionEvidenceRecord;
  cursor: { ts: string; id: string };
}

// Keyset page fetch: returns up to `limit + 1` rows in the query's natural order
// (DESC for the first page / "next", ASC for "prev"), each paired with its
// (created_at, id) boundary. The caller passes these to buildKeysetPage. See
// database-optimizations-audit finding 7. Ordering matches
// runtime_evidence_workspace_created_idx (tenant_id, workspace_id, created_at
// DESC); the id tie-breaker keeps rows sharing a created_at from being skipped
// or duplicated at a page boundary.
export async function listRuntimeEvidenceKeyset(
  workspaceId: string | null,
  tenantId: string,
  limit: number,
  cursor: KeysetCursor | null,
): Promise<RuntimeEvidenceKeysetRow[]> {
  if (!sql) return [];
  const ascending = cursor?.dir === "prev";
  const keysetPredicate = cursor
    ? ascending
      ? rawSql`AND (event.created_at > ${cursor.ts}::timestamptz OR (event.created_at = ${cursor.ts}::timestamptz AND event.id > ${cursor.id}::uuid))`
      : rawSql`AND (event.created_at < ${cursor.ts}::timestamptz OR (event.created_at = ${cursor.ts}::timestamptz AND event.id < ${cursor.id}::uuid))`
    : rawSql``;
  const ordering = ascending
    ? rawSql`ORDER BY event.created_at ASC, event.id ASC`
    : rawSql`ORDER BY event.created_at DESC, event.id DESC`;

  const rows = await sql<(RuntimeEvidenceRow & { id: string })[]>`
    SELECT
      event.id, event.decision_id, event.tenant_id, event.workspace_id, event.environment,
      event.runtime_stack, event.runtime_adapter, event.agent_id, event.connector, event.action,
      event.status, event.reason, event.policy_refs, event.artifact_hash, event.policy_context,
      event.raw_evidence, event.latency_ms, event.created_at
    FROM runtime_evidence_event event
    JOIN runtime_evidence_event_key event_key
      ON event_key.tenant_id = event.tenant_id
     AND event_key.decision_id = event.decision_id
     AND event_key.evidence_event_id = event.id
    WHERE event.tenant_id = ${tenantId}
      AND event.workspace_id = ${workspaceId}
      ${keysetPredicate}
    ${ordering}
    LIMIT ${limit + 1}
  `;

  const packByRevisionId = await loadRevisionPackMetadata(
    tenantId,
    revisionIdsFromEvidenceRows(rows),
  );
  return rows.map((row) => ({
    record: mapRuntimeEvidenceRow(row, packByRevisionId),
    cursor: { ts: row.created_at.toISOString(), id: row.id },
  }));
}

function revisionIdsFromEvidenceRows(rows: RuntimeEvidenceRow[]): string[] {
  return Array.from(
    new Set(
      rows.flatMap((row) =>
        Array.isArray(row.policy_context)
          ? (row.policy_context as RuntimePolicyContext[])
              .map((context) => context.revisionId)
              .filter(
                (revisionId): revisionId is string =>
                  typeof revisionId === "string" && !!revisionId,
              )
          : [],
      ),
    ),
  );
}

async function loadRevisionPackMetadata(
  tenantId: string,
  revisionIds: string[],
): Promise<Map<string, RevisionPackMetadata>> {
  const packByRevisionId = new Map<string, RevisionPackMetadata>();
  if (!sql || revisionIds.length === 0) return packByRevisionId;

  const revisionRows = await sql<RevisionMetadataRow[]>`
    SELECT
      pr.id AS revision_id,
      pb.name AS branch_name,
      pr.author_id,
      pr.created_at AS revision_created_at,
      COALESCE(approval_summary.approval_count, 0)::text AS approval_count,
      COALESCE(approval_summary.approver_ids, ARRAY[]::text[]) AS approver_ids,
      latest_publish.published_at,
      latest_publish.published_by,
      pr.source_document
    FROM policy_revision pr
    JOIN policy_branch pb
      ON pb.id = pr.branch_id
     AND pb.tenant_id = pr.tenant_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE status = 'APPROVED') AS approval_count,
        ARRAY_AGG(reviewer_id ORDER BY reviewed_at DESC NULLS LAST)
          FILTER (WHERE status = 'APPROVED') AS approver_ids
      FROM policy_approval pa
      WHERE pa.tenant_id = pr.tenant_id
        AND pa.revision_id = pr.id
    ) approval_summary ON true
    LEFT JOIN LATERAL (
      SELECT pp.published_at, pp.published_by
      FROM policy_publish pp
      WHERE pp.tenant_id = pr.tenant_id
        AND pp.revision_id = pr.id
      ORDER BY pp.published_at DESC
      LIMIT 1
    ) latest_publish ON true
    WHERE pr.tenant_id = ${tenantId}
      AND pr.id = ANY(${revisionIds})
  `;

  for (const revisionRow of revisionRows) {
    packByRevisionId.set(revisionRow.revision_id, mapRevisionMetadataRow(revisionRow));
  }
  return packByRevisionId;
}

function mapRevisionMetadataRow(revisionRow: RevisionMetadataRow): RevisionPackMetadata {
  const sourceDocument = objectRecord(revisionRow.source_document);
  const metadata = objectRecord(sourceDocument.metadata);
  const spctrePack = objectRecord(metadata.spctre_pack);

  return {
    branchName: revisionRow.branch_name ?? undefined,
    revisionAuthorId: revisionRow.author_id ?? undefined,
    revisionCreatedAt: revisionRow.revision_created_at?.toISOString(),
    approvalCount: Number.parseInt(revisionRow.approval_count ?? "0", 10),
    approverIds: revisionRow.approver_ids ?? [],
    publishedAt: revisionRow.published_at?.toISOString(),
    publishedBy: revisionRow.published_by ?? undefined,
    packId: stringField(spctrePack.packId) ?? stringField(metadata.name),
    packVersion: stringField(spctrePack.version) ?? stringField(metadata.version),
    packOwner: stringField(spctrePack.owner) ?? stringField(metadata.owner),
  };
}

function mapRuntimeEvidenceRow(
  row: RuntimeEvidenceRow,
  packByRevisionId: Map<string, RevisionPackMetadata>,
): RuntimeDecisionEvidenceRecord {
  const rawEvidence = objectRecord(row.raw_evidence);
  const rawRuntimeTarget = objectField(rawEvidence.runtimeTarget);
  const rawExecutionContext = objectField(rawEvidence.executionContext);
  return {
    decisionId: row.decision_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    environment: row.environment,
    runtimeTarget: {
      stack: row.runtime_stack as RuntimeStack,
      adapter: row.runtime_adapter ?? undefined,
      environment: stringField(rawRuntimeTarget?.environment),
      sandboxName:
        stringField(rawRuntimeTarget?.sandboxName) ?? stringField(rawExecutionContext?.sandboxName),
      inferenceProvider:
        stringField(rawRuntimeTarget?.inferenceProvider) ??
        stringField(rawExecutionContext?.inferenceProvider),
    },
    agentId: row.agent_id,
    connector: row.connector,
    action: row.action,
    status: row.status as RuntimeDecisionEvidenceRecord["status"],
    reason: row.reason,
    policyRefs: row.policy_refs ?? [],
    artifactHash: row.artifact_hash,
    policyContext: enrichPolicyContext(row.policy_context, packByRevisionId),
    latencyMs: row.latency_ms ?? 0,
    createdAt: row.created_at.toISOString(),
    rawEvidence,
    toolIntent: stringField(rawEvidence.toolIntent),
    planSummary: stringField(rawEvidence.planSummary),
    toolParameters: objectField(rawEvidence.toolParameters),
    triggerKind: stringField(
      rawEvidence.triggerKind,
    ) as RuntimeDecisionEvidenceRecord["triggerKind"],
    layer: stringField(rawEvidence.layer) as RuntimeDecisionEvidenceRecord["layer"],
    executionContext: rawExecutionContext as RuntimeDecisionEvidenceRecord["executionContext"],
    parentAgentId: stringField(rawEvidence.parentAgentId),
    traceId: stringField(rawEvidence.traceId),
    orchestratorRef: objectField(
      rawEvidence.orchestratorRef,
    ) as RuntimeDecisionEvidenceRecord["orchestratorRef"],
    pluginSource: stringField(
      rawEvidence.pluginSource,
    ) as RuntimeDecisionEvidenceRecord["pluginSource"],
    skillContext: objectField(
      rawEvidence.skillContext,
    ) as RuntimeDecisionEvidenceRecord["skillContext"],
    webhookSource: stringField(rawEvidence.webhookSource),
    trustLevel: stringField(rawEvidence.trustLevel),
    catalogProvider: stringField(rawEvidence.catalogProvider),
    blueprintContext: objectField(
      rawEvidence.blueprintContext,
    ) as RuntimeDecisionEvidenceRecord["blueprintContext"],
  };
}

function enrichPolicyContext(
  policyContext: unknown,
  packByRevisionId: Map<string, RevisionPackMetadata>,
): RuntimePolicyContext[] {
  if (!Array.isArray(policyContext)) return [];
  return (policyContext as RuntimePolicyContext[]).map((context) => {
    const pack = packByRevisionId.get(context.revisionId);
    return {
      ...context,
      packId: context.packId ?? pack?.packId,
      packVersion: context.packVersion ?? pack?.packVersion,
      packOwner: context.packOwner ?? pack?.packOwner,
      branchName: pack?.branchName,
      revisionAuthorId: pack?.revisionAuthorId,
      revisionCreatedAt: pack?.revisionCreatedAt,
      approvalCount: pack?.approvalCount,
      approverIds: pack?.approverIds,
      publishedAt: pack?.publishedAt,
      publishedBy: pack?.publishedBy,
    };
  });
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function canonicalizeEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeEvidenceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalizeEvidenceValue(child)]),
    );
  }
  return value;
}

function buildEvidenceContentHash(input: {
  tenantId: string;
  workspaceId: string;
  decisionId: string;
  artifactHash: string;
  status: string;
  policyContext: unknown;
  rawEvidence: unknown;
  createdAt: string;
  prevHash: string | null;
}): string {
  const source = JSON.stringify(canonicalizeEvidenceValue(input));
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

export function isEvidenceDatabaseConfigured(): boolean {
  return Boolean(sql);
}

export async function ensureEvidenceDemoTenant(): Promise<void> {
  await ensureDemoTenant();
}

export async function validateEvidenceWorkspaceBoundary(
  tenantId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sql) return { ok: false, error: "Database not configured." };

  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM workspace
    WHERE tenant_id = ${tenantId}
      AND id = ${workspaceId}
    LIMIT 1
  `;

  return rows.length
    ? { ok: true }
    : { ok: false, error: "Workspace is not available in the selected tenant." };
}

export async function validateEvidencePolicyContextBoundary(
  policyContext: RuntimePolicyContext[],
  tenantId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sql) return { ok: false, error: "Database not configured." };
  if (policyContext.length === 0) return { ok: true };

  // Batched boundary check: one query validates every (revision, branch) pair
  // instead of one round trip per policy-context entry on the ingest hot path.
  // See database-optimizations-audit finding 4.
  const revisionIds = policyContext.map((context) => context.revisionId);
  const branchIds = policyContext.map((context) => context.branchId);

  const rows = await sql<{ id: string; branch_id: string }[]>`
    SELECT pr.id, pr.branch_id
    FROM policy_revision pr
    JOIN policy_branch pb ON pb.id = pr.branch_id AND pb.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ${tenantId}
      AND (pr.id, pr.branch_id) IN (
        SELECT * FROM unnest(${revisionIds}::uuid[], ${branchIds}::uuid[])
      )
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
  `;

  const allowedPairs = new Set(rows.map((row) => `${row.id}:${row.branch_id}`));
  const everyPairAllowed = policyContext.every((context) =>
    allowedPairs.has(`${context.revisionId}:${context.branchId}`),
  );

  if (!everyPairAllowed) {
    return {
      ok: false,
      error: "Policy context contains a branch or revision outside this tenant/workspace.",
    };
  }

  return { ok: true };
}

export async function insertRuntimeEvidenceWithDedup(params: {
  tenantId: string;
  workspaceId: string;
  evidence: RuntimeDecisionEvidenceRecord;
  rawEvidenceWithSource: Record<string, unknown>;
  executionTrace: unknown;
  engineVersion: string | null;
}): Promise<{ inserted: boolean }> {
  if (!sql) return { inserted: false };

  const inserted = await sql.begin(async (tx) => {
    const keyRows = await tx<{ decision_id: string }[]>`
      INSERT INTO runtime_evidence_event_key (tenant_id, decision_id)
      VALUES (${params.tenantId}, ${params.evidence.decisionId})
      ON CONFLICT (tenant_id, decision_id) DO NOTHING
      RETURNING decision_id
    `;
    if (keyRows.length === 0) return [];

    // Serialize per-tenant appends through the chain-head row: the upsert takes a
    // row lock (shared with the worker's insertEvidence, replacing the old
    // pg_advisory_xact_lock) and last_hash is the O(1) prev-hash read instead of
    // a partition-wide tail scan. See database-optimizations-audit finding 2.
    const headRows = await tx<{ last_hash: string | null }[]>`
      INSERT INTO runtime_evidence_chain_head (tenant_id, last_hash)
      VALUES (${params.tenantId}, NULL)
      ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
      RETURNING last_hash
    `;
    const prevHash = headRows[0]?.last_hash ?? null;
    const contentHash = buildEvidenceContentHash({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      decisionId: params.evidence.decisionId,
      artifactHash: params.evidence.artifactHash,
      status: params.evidence.status,
      policyContext: params.evidence.policyContext,
      rawEvidence: params.rawEvidenceWithSource,
      createdAt: params.evidence.createdAt,
      prevHash,
    });

    const insertedRows = await tx<{ id: string; decision_id: string; created_at: Date }[]>`
      INSERT INTO runtime_evidence_event (
        decision_id, tenant_id, workspace_id, environment,
        runtime_stack, runtime_adapter, agent_id, connector, action,
        status, reason, policy_refs, artifact_hash, policy_context,
        raw_evidence, latency_ms, created_at, execution_trace, engine_version,
        evidence_content_hash, evidence_prev_hash
      ) VALUES (
        ${params.evidence.decisionId}, ${params.tenantId}, ${params.workspaceId}, ${params.evidence.environment},
        ${params.evidence.runtimeTarget.stack}, ${params.evidence.runtimeTarget.adapter ?? null},
        ${params.evidence.agentId}, ${params.evidence.connector}, ${params.evidence.action},
        ${params.evidence.status}, ${params.evidence.reason}, ${params.evidence.policyRefs},
        ${params.evidence.artifactHash}, ${tx.json(params.evidence.policyContext as unknown as JSONValue)},
        ${tx.json(params.rawEvidenceWithSource as JSONValue)}, ${params.evidence.latencyMs}, ${params.evidence.createdAt},
        ${params.executionTrace ? tx.json(params.executionTrace as JSONValue) : null}::jsonb,
        ${params.engineVersion}, ${contentHash}, ${prevHash}
      )
      RETURNING id, decision_id, created_at
    `;

    if (insertedRows[0]) {
      await tx`
        UPDATE runtime_evidence_event_key
        SET evidence_event_id = ${insertedRows[0].id},
            evidence_created_at = ${insertedRows[0].created_at}
        WHERE tenant_id = ${params.tenantId}
          AND decision_id = ${params.evidence.decisionId}
      `;
      // Advance the chain head to this event's hash so the next append links to it.
      await tx`
        UPDATE runtime_evidence_chain_head
        SET last_hash = ${contentHash}, updated_at = now()
        WHERE tenant_id = ${params.tenantId}
      `;
    }

    return insertedRows;
  });

  if (inserted.length > 0) {
    const plan = getSpctrePlan();
    if (isFeatureEnabledForPlan("longTermForensicArchival", plan)) {
      // Await archival before returning. Previously this was a fire-and-forget
      // .then() chain, but on scale-to-zero runtimes (Cloud Run, §41) CPU is
      // throttled once the response is sent, so a dangling promise may never
      // run — silent data loss for a compliance feature — and a burst leaks one
      // promise chain per event. Awaiting guarantees execution before the
      // response and bounds concurrency to in-flight requests. Failures stay
      // non-fatal so archival trouble never blocks evidence ingest.
      // See concurrency-and-memory-audit finding 6.
      try {
        const profile = await getCommercialProfile(params.tenantId);
        let retentionDays = 90;
        if (profile?.planCode === "TEAM") {
          retentionDays = 365;
        } else if (profile?.planCode === "BUSINESS") {
          retentionDays = 1095;
        } else if (profile?.planCode === "ENTERPRISE") {
          retentionDays = profile.retentionWindowDays ?? 2555;
        }
        const retainUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
        await archivalService.store({
          decisionId: params.evidence.decisionId,
          workspaceId: params.workspaceId,
          tenantId: params.tenantId,
          payload: params.rawEvidenceWithSource,
          retainUntil,
        });
      } catch (err) {
        logger.error("[Forensic Archival Error] Failed to archive record:", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { inserted: inserted.length > 0 };
}

export async function insertGatewayEvidenceEvent(params: {
  tenantId: string;
  workspaceId: string;
  decisionId: string;
  environment: string;
  runtimeStack: string;
  runtimeAdapter: string | null;
  agentId: string;
  connector: string;
  action: string;
  status: string;
  reason: string;
  policyRefs: string[];
  artifactHash: string;
  policyContext: unknown[];
  rawEvidence: Record<string, unknown>;
  latencyMs: number;
  createdAt: string;
}): Promise<{ deduplicated: boolean }> {
  if (!sql) throw new Error("Database not configured.");

  const inserted = await sql.begin(async (tx) => {
    const keyRows = await tx<{ decision_id: string }[]>`
      INSERT INTO runtime_evidence_event_key (tenant_id, decision_id)
      VALUES (${params.tenantId}, ${params.decisionId})
      ON CONFLICT (tenant_id, decision_id) DO NOTHING
      RETURNING decision_id
    `;
    if (keyRows.length === 0) return [];

    // Serialize per-tenant appends through the chain-head row (shared row lock
    // with insertRuntimeEvidenceWithDedup and the worker's insertEvidence,
    // replacing pg_advisory_xact_lock); last_hash is the O(1) prev-hash read.
    // See database-optimizations-audit finding 2.
    const headRows = await tx<{ last_hash: string | null }[]>`
      INSERT INTO runtime_evidence_chain_head (tenant_id, last_hash)
      VALUES (${params.tenantId}, NULL)
      ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
      RETURNING last_hash
    `;
    const prevHash = headRows[0]?.last_hash ?? null;
    const contentHash = buildEvidenceContentHash({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      decisionId: params.decisionId,
      artifactHash: params.artifactHash,
      status: params.status,
      policyContext: params.policyContext,
      rawEvidence: params.rawEvidence,
      createdAt: params.createdAt,
      prevHash,
    });

    const insertedRows = await tx<{ decision_id: string }[]>`
      INSERT INTO runtime_evidence_event (
        decision_id, tenant_id, workspace_id, environment,
        runtime_stack, runtime_adapter, agent_id, connector, action,
        status, reason, policy_refs, artifact_hash, policy_context,
        raw_evidence, latency_ms, created_at,
        evidence_content_hash, evidence_prev_hash
      ) VALUES (
        ${params.decisionId}, ${params.tenantId}, ${params.workspaceId}, ${params.environment},
        ${params.runtimeStack}, ${params.runtimeAdapter},
        ${params.agentId}, ${params.connector}, ${params.action},
        ${params.status}, ${params.reason}, ${params.policyRefs},
        ${params.artifactHash}, ${tx.json(params.policyContext as JSONValue)},
        ${tx.json(params.rawEvidence as JSONValue)}, ${params.latencyMs}, ${params.createdAt},
        ${contentHash}, ${prevHash}
      )
      ON CONFLICT (tenant_id, decision_id, created_at) DO NOTHING
      RETURNING decision_id
    `;

    // Only advance the chain head if the event was actually inserted; an
    // ON CONFLICT no-op must not move the head to a hash with no backing row.
    if (insertedRows.length > 0) {
      await tx`
        UPDATE runtime_evidence_chain_head
        SET last_hash = ${contentHash}, updated_at = now()
        WHERE tenant_id = ${params.tenantId}
      `;
    }

    return insertedRows;
  });

  return { deduplicated: inserted.length === 0 };
}

export async function countMonthlyEvidenceEvents(tenantId: string): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND created_at >= date_trunc('month', now())
    `;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  } catch {
    return 0;
  }
}

// Counts a tenant's total retained governed events for the HOSTED_TRIAL cap,
// which is checked on every ingest POST. Counts runtime_evidence_event_key
// (non-partitioned, PK (tenant_id, decision_id)) rather than the partitioned
// runtime_evidence_event ledger: the key table has exactly one row per retained
// event (inserted in the same transaction as the event, pruned together on
// retention/hard-delete, and tombstoned-in-place rows are retained in both), so
// this is an index-only scan of one table instead of a tenant_id scan fanned
// out across every monthly partition. See database-optimizations-audit finding 5.
export async function countTotalEvidenceEvents(tenantId: string): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM runtime_evidence_event_key
      WHERE tenant_id = ${tenantId}
    `;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  } catch {
    return 0;
  }
}

export async function getConnectorActionByDecisionId(
  tenantId: string,
  decisionId: string,
): Promise<{ connector: string; action: string } | null> {
  if (!sql || !decisionId) return null;
  try {
    const rows = await sql<{ connector: string; action: string }[]>`
      SELECT connector, action
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND decision_id = ${decisionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getRawEvidenceForArchival(
  tenantId: string,
  decisionIds: string[],
): Promise<
  { decision_id: string; workspace_id: string; tenant_id: string; raw_evidence: unknown }[]
> {
  if (!sql || !decisionIds.length) return [];
  try {
    const rows = await sql<
      { decision_id: string; workspace_id: string; tenant_id: string; raw_evidence: unknown }[]
    >`
      SELECT decision_id, workspace_id, tenant_id, raw_evidence
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND decision_id = ANY(${decisionIds})
    `;
    return rows;
  } catch {
    return [];
  }
}

export interface ForensicEvidenceRow {
  decision_id: string;
  environment: string;
  runtime_stack: string;
  runtime_adapter: string | null;
  agent_id: string;
  connector: string;
  action: string;
  status: string;
  reason: string;
  policy_refs: string[];
  artifact_hash: string;
  policy_context: unknown;
  raw_evidence: unknown;
  latency_ms: number | null;
  created_at: Date;
}

export async function queryForensicEvidence(params: {
  tenantId: string;
  workspaceId: string;
  limit: number;
  from: string | null;
  to: string | null;
  cursor: string | null;
}): Promise<ForensicEvidenceRow[]> {
  if (!sql) throw new Error("Database not configured.");
  const { tenantId, workspaceId, limit, from, to, cursor } = params;
  return sql<ForensicEvidenceRow[]>`
    SELECT
      decision_id, environment, runtime_stack, runtime_adapter, agent_id,
      connector, action, status, reason, policy_refs, artifact_hash,
      policy_context, raw_evidence, latency_ms, created_at
    FROM runtime_evidence_event
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND (${from}::timestamptz IS NULL OR created_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR created_at < ${to}::timestamptz)
      AND (${cursor}::timestamptz IS NULL OR created_at < ${cursor}::timestamptz)
    ORDER BY created_at DESC
    LIMIT ${limit + 1}
  `;
}
