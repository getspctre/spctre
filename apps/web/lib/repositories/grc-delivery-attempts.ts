import { sql } from "@/lib/db";

export async function recordGrcDeliveryAttempt(params: {
  tenantId: string;
  workspaceId: string;
  destinationId: string;
  idempotencyKey: string;
  artifactHash: string;
  status: "DELIVERED" | "RETRYABLE_FAILURE" | "TERMINAL_FAILURE";
  httpStatus?: number;
  errorCode?: string;
}) {
  if (!sql) return;
  await sql`INSERT INTO grc_delivery_attempt (tenant_id, workspace_id, destination_id, idempotency_key, artifact_hash, status, http_status, error_code)
    VALUES (${params.tenantId}, ${params.workspaceId}, ${params.destinationId}, ${params.idempotencyKey}, ${params.artifactHash}, ${params.status}, ${params.httpStatus ?? null}, ${params.errorCode ?? null})`;
}

export async function listGrcDeliveryAttempts(params: {
  tenantId: string;
  workspaceId: string;
  destinationId?: string;
  limit?: number;
}) {
  if (!sql) return [];
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  return sql<
    {
      id: string;
      destination_id: string;
      idempotency_key: string;
      artifact_hash: string;
      status: string;
      http_status: number | null;
      error_code: string | null;
      created_at: Date;
    }[]
  >`
    SELECT id, destination_id, idempotency_key, artifact_hash, status, http_status, error_code, created_at
    FROM grc_delivery_attempt WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
      AND (${params.destinationId ?? null}::uuid IS NULL OR destination_id = ${params.destinationId ?? null}::uuid)
    ORDER BY created_at DESC LIMIT ${limit}`;
}
