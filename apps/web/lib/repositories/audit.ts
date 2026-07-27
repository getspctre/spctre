import { sql } from "@/lib/db";

export interface DbAuditLogNode {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  event_type: string;
  source_id: string | null;
  source_table: string | null;
  actor_id: string;
  payload: Record<string, unknown>;
  content_hash: string;
  prev_hash: string | null;
  created_at: Date;
}

export async function queryAuditLogs(params: {
  eventType: string | null;
  actorId: string | null;
  limit: number;
  offset: number;
}): Promise<DbAuditLogNode[]> {
  if (!sql) return [];

  return await sql<DbAuditLogNode[]>`
    SELECT
      id, tenant_id, workspace_id, event_type, source_id, source_table,
      actor_id, payload, content_hash, prev_hash, created_at
    FROM agt_operations_log
    WHERE 1=1
      ${params.eventType ? sql`AND event_type = ${params.eventType}` : sql``}
      ${params.actorId ? sql`AND actor_id = ${params.actorId}` : sql``}
    ORDER BY created_at ASC
    LIMIT ${params.limit} OFFSET ${params.offset}
  `;
}
