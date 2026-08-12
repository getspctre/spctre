import { logger } from "@spctre/platform/logging";
import type { JSONValue } from "postgres";
import { sql, rawSql } from "@/lib/db";
import type { TxClient } from "@/lib/db";
import { isRecord } from "@/lib/records";
import type { KeysetCursor } from "@/lib/pagination/keyset";
import { buildOperationsContentHash, validateOperationsLogChain } from "@spctre/policy-schema";
import type {
  OperationsLogChainVerification,
  OperationsLogEntry,
  OperationsLogEventType,
} from "@spctre/policy-schema";

export async function appendOperationsLog(params: {
  tenantId: string;
  workspaceId?: string;
  eventType: OperationsLogEventType;
  sourceId?: string;
  sourceTable?: string;
  actorId: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!sql) return;
  try {
    await sql.begin((tx) => appendOperationsLogInTransaction(tx, params));
  } catch (err) {
    logger.error("[operations_log] append failed (non-fatal):", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function appendOperationsLogInTransaction(
  tx: TxClient,
  params: {
    tenantId: string;
    workspaceId?: string;
    eventType: OperationsLogEventType;
    sourceId?: string;
    sourceTable?: string;
    actorId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  // Serialize per-tenant appends through the chain-head row: the upsert takes
  // a row lock so concurrent appends can't read the same prev_hash and fork
  // the chain, and last_hash gives an O(1) prev-hash read. Mirrors the
  // worker's evidence-chain fix. See concurrency-and-memory-audit finding 2.
  const headRows = await tx<{ last_hash: string | null }[]>`
        INSERT INTO agt_operations_log_chain_head (tenant_id, last_hash)
        VALUES (${params.tenantId}, NULL)
        ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
        RETURNING last_hash
      `;
  const prevHash = headRows[0]?.last_hash ?? null;

  const contentHash = buildOperationsContentHash({
    eventType: params.eventType,
    sourceId: params.sourceId ?? null,
    sourceTable: params.sourceTable ?? null,
    actorId: params.actorId ?? "",
    payload: params.payload,
    prevHash,
  });

  await tx`
        INSERT INTO agt_operations_log (
          tenant_id, workspace_id, event_type, source_id, source_table,
          actor_id, payload, content_hash, prev_hash
        ) VALUES (
          ${params.tenantId}, ${params.workspaceId ?? null}, ${params.eventType},
          ${params.sourceId ?? null}, ${params.sourceTable ?? null},
          ${params.actorId ?? ""}, ${tx.json(params.payload as JSONValue)}::jsonb,
          ${contentHash}, ${prevHash}
        )
      `;

  await tx`
        UPDATE agt_operations_log_chain_head
        SET last_hash = ${contentHash}, updated_at = now()
        WHERE tenant_id = ${params.tenantId}
  `;
}

type OperationsLogDbRow = {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  event_type: string;
  source_id: string | null;
  source_table: string | null;
  actor_id: string;
  payload: unknown;
  content_hash: string;
  prev_hash: string | null;
  created_at: Date;
};

function mapOperationsLogRow(row: OperationsLogDbRow): OperationsLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id ?? undefined,
    eventType: row.event_type as OperationsLogEventType,
    sourceId: row.source_id ?? undefined,
    sourceTable: row.source_table ?? undefined,
    actorId: row.actor_id,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    contentHash: row.content_hash,
    prevHash: row.prev_hash ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listOperationsLog(
  tenantId: string,
  workspaceId?: string,
  options: { eventType?: OperationsLogEventType; limit?: number; offset?: number } = {},
): Promise<OperationsLogEntry[]> {
  if (!sql) return [];
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  try {
    const rows = await sql<OperationsLogDbRow[]>`
      SELECT id, tenant_id, workspace_id, event_type, source_id, source_table,
             actor_id, payload, content_hash, prev_hash, created_at
      FROM agt_operations_log
      WHERE tenant_id = ${tenantId}
        ${workspaceId ? rawSql`AND (workspace_id = ${workspaceId} OR workspace_id IS NULL)` : rawSql``}
        ${options.eventType ? rawSql`AND event_type = ${options.eventType}` : rawSql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map(mapOperationsLogRow);
  } catch (err) {
    logger.error("[listOperationsLog] failed:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// Keyset variant of listOperationsLog: returns up to `limit + 1` entries in the
// query's natural order (DESC for the first page / "next", ASC for "prev") for
// buildKeysetPage. Each OperationsLogEntry already carries id + createdAt, which
// serve as the (created_at, id) boundary. See database-optimizations-audit
// finding 7. Ordering matches agt_operations_log_tenant_time_idx (tenant_id,
// created_at DESC); id breaks created_at ties so page boundaries are stable.
export async function listOperationsLogKeyset(
  tenantId: string,
  workspaceId?: string,
  options: {
    eventType?: OperationsLogEventType;
    entryId?: string;
    limit?: number;
    cursor?: KeysetCursor | null;
  } = {},
): Promise<OperationsLogEntry[]> {
  if (!sql) return [];
  const limit = options.limit ?? 100;
  const cursor = options.cursor ?? null;
  const ascending = cursor?.dir === "prev";
  const keysetPredicate = cursor
    ? ascending
      ? rawSql`AND (created_at > ${cursor.ts}::timestamptz OR (created_at = ${cursor.ts}::timestamptz AND id > ${cursor.id}::uuid))`
      : rawSql`AND (created_at < ${cursor.ts}::timestamptz OR (created_at = ${cursor.ts}::timestamptz AND id < ${cursor.id}::uuid))`
    : rawSql``;
  const ordering = ascending
    ? rawSql`ORDER BY created_at ASC, id ASC`
    : rawSql`ORDER BY created_at DESC, id DESC`;
  try {
    const rows = await sql<OperationsLogDbRow[]>`
      SELECT id, tenant_id, workspace_id, event_type, source_id, source_table,
             actor_id, payload, content_hash, prev_hash, created_at
      FROM agt_operations_log
      WHERE tenant_id = ${tenantId}
        ${workspaceId ? rawSql`AND (workspace_id = ${workspaceId} OR workspace_id IS NULL)` : rawSql``}
        ${options.eventType ? rawSql`AND event_type = ${options.eventType}` : rawSql``}
        ${options.entryId ? rawSql`AND id = ${options.entryId}::uuid` : rawSql``}
        ${keysetPredicate}
      ${ordering}
      LIMIT ${limit + 1}
    `;
    return rows.map(mapOperationsLogRow);
  } catch (err) {
    logger.error("[listOperationsLogKeyset] failed:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function getOperationsLogEventCounts(
  tenantId: string,
  workspaceId: string,
): Promise<Record<string, number>> {
  if (!sql) return {};
  try {
    const rows = await sql<{ event_type: string; count: string }[]>`
      SELECT event_type, COUNT(*)::text AS count
      FROM agt_operations_log
      WHERE tenant_id = ${tenantId}
        AND (workspace_id = ${workspaceId} OR workspace_id IS NULL)
      GROUP BY event_type
    `;
    return Object.fromEntries(rows.map((r) => [r.event_type, parseInt(r.count, 10)]));
  } catch {
    return {};
  }
}

type OperationsLogChainRow = {
  id: string;
  event_type: string;
  source_id: string | null;
  source_table: string | null;
  actor_id: string;
  payload: unknown;
  content_hash: string;
  prev_hash: string | null;
  created_at: Date;
};

function orderOperationsLogRowsForVerification(
  rows: OperationsLogChainRow[],
): OperationsLogChainRow[] {
  const byPrevHash = new Map<string | null, OperationsLogChainRow[]>();
  for (const row of rows) {
    const siblings = byPrevHash.get(row.prev_hash) ?? [];
    siblings.push(row);
    byPrevHash.set(row.prev_hash, siblings);
  }

  const ordered: OperationsLogChainRow[] = [];
  const seen = new Set<string>();
  let nextRows = byPrevHash.get(null) ?? [];

  while (nextRows.length > 0) {
    const row = nextRows[0];
    if (!row || seen.has(row.content_hash)) break;
    ordered.push(row);
    seen.add(row.content_hash);
    nextRows = byPrevHash.get(row.content_hash) ?? [];
  }

  if (ordered.length !== rows.length) {
    for (const row of rows) {
      if (!seen.has(row.content_hash)) ordered.push(row);
    }
  }

  return ordered;
}

export async function verifyOperationsLogChain(
  tenantId: string,
  limit = 500,
): Promise<OperationsLogChainVerification> {
  const checkedAt = new Date().toISOString();
  if (!sql) return { verified: true, totalEntries: 0, checkedAt };

  try {
    const rows = await sql<OperationsLogChainRow[]>`
      SELECT id, event_type, source_id, source_table, actor_id, payload,
             content_hash, prev_hash, created_at
      FROM agt_operations_log
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit}
    `;

    if (rows.length === 0) return { verified: true, totalEntries: 0, checkedAt };

    const orderedRows = orderOperationsLogRowsForVerification(rows);
    const validation = validateOperationsLogChain(
      orderedRows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        sourceId: row.source_id,
        sourceTable: row.source_table,
        actorId: row.actor_id,
        payload: isRecord(row.payload) ? row.payload : {},
        contentHash: row.content_hash,
        prevHash: row.prev_hash,
        createdAt: row.created_at.toISOString(),
      })),
    );

    const issue = validation.issues[0];
    if (issue) {
      return {
        verified: false,
        totalEntries: rows.length,
        brokenAt: issue.createdAt,
        brokenEntryId: issue.entryId,
        checkedAt,
      };
    }

    return { verified: true, totalEntries: rows.length, checkedAt };
  } catch {
    return { verified: false, totalEntries: 0, checkedAt };
  }
}
