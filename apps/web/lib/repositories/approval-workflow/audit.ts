import { sql } from "@/lib/db";

export interface ApprovalWorkflowAuditEvent {
  id: string;
  workflowId: string | null;
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export async function listApprovalWorkflowAuditEvents(
  tenantId: string,
  limit = 20
): Promise<ApprovalWorkflowAuditEvent[]> {
  if (!sql) return [];
  const rows = await sql<{
    id: string;
    workflow_id: string | null;
    workspace_id: string | null;
    actor_id: string | null;
    action: string;
    detail: unknown;
    created_at: Date;
  }[]>`
    SELECT id, workflow_id, workspace_id, actor_id, action, detail, created_at
    FROM approval_workflow_audit_event
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    action: row.action,
    detail: row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : {},
    createdAt: row.created_at.toISOString(),
  }));
}

export async function insertWorkflowAuditEvent(params: {
  tenantId: string;
  workspaceId?: string | null;
  workflowId?: string | null;
  actorId: string;
  action: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO approval_workflow_audit_event (
      tenant_id, workspace_id, workflow_id, actor_id, action, detail
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId ?? null}, ${params.workflowId ?? null},
      ${params.actorId}, ${params.action}, ${JSON.stringify(params.detail)}::jsonb
    )
  `;
}

export async function deleteActiveApprovals(params: {
  tenantId: string;
  workspaceId: string | null;
  environment: string | null;
}): Promise<number> {
  if (!sql) return 0;
  const rows = await sql<{ id: string }[]>`
    DELETE FROM policy_approval pa
    USING policy_revision pr
    JOIN policy_branch pb ON pb.id = pr.branch_id
    WHERE pa.revision_id = pr.id
      AND pa.tenant_id = ${params.tenantId}
      AND pr.tenant_id = ${params.tenantId}
      AND pb.tenant_id = ${params.tenantId}
      AND pb.active_revision_id = pr.id
      AND (${params.workspaceId}::uuid IS NULL OR pr.workspace_id = ${params.workspaceId})
      AND (${params.environment}::text IS NULL OR pb.environment = ${params.environment})
      AND NOT EXISTS (
        SELECT 1 FROM policy_publish pp
        WHERE pp.tenant_id = ${params.tenantId} AND pp.revision_id = pr.id
      )
    RETURNING pa.id
  `;
  return rows.length;
}
