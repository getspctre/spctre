import { sql } from "@/lib/db";
import type { TenantSummary, WorkspaceSummary } from "@/lib/workspace/types";

export async function listTenantsForWorkspaceContext(params: {
  principalSubject?: string;
  fallbackTenantId?: string;
}): Promise<TenantSummary[]> {
  if (!sql) return [];

  if (params.principalSubject) {
    return sql<TenantSummary[]>`
      SELECT t.id, t.slug, t.name
      FROM tenant t
      JOIN app_principal p ON p.tenant_id = t.id
      WHERE p.subject = ${params.principalSubject}
      ORDER BY t.created_at ASC
    `;
  }

  return sql<TenantSummary[]>`
    SELECT id, slug, name
    FROM tenant
    WHERE id = ${params.fallbackTenantId ?? ""}
    ORDER BY created_at ASC
  `;
}

/**
 * Returns the workspaces the given principal has access to within a tenant.
 * A principal_permission_grant row with workspace_id IS NULL grants access to all
 * workspaces in the tenant (org-level grant). When no principalId is provided
 * (demo / unauthenticated path) all tenant workspaces are returned.
 */
export async function listWorkspacesForWorkspaceContext(
  tenantId: string,
  principalId?: string,
): Promise<WorkspaceSummary[]> {
  if (!sql) return [];

  if (!principalId) {
    return sql<WorkspaceSummary[]>`
      SELECT id, slug, name
      FROM workspace
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `;
  }

  return sql<WorkspaceSummary[]>`
    SELECT w.id, w.slug, w.name
    FROM workspace w
    WHERE w.tenant_id = ${tenantId}
      AND EXISTS (
        SELECT 1 FROM principal_permission_grant ppg
        WHERE ppg.tenant_id = w.tenant_id
          AND ppg.principal_id = ${principalId}::uuid
          AND (ppg.workspace_id = w.id OR ppg.workspace_id IS NULL)
      )
    ORDER BY w.created_at ASC
  `;
}
