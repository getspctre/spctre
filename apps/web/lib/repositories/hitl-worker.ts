import { sql } from "@/lib/db";

export interface DbWorkspaceInfo {
  id: string;
  name: string;
}

export async function listAllTenants(): Promise<{ id: string }[]> {
  if (!sql) return [];
  return await sql<{ id: string }[]>`SELECT id FROM tenant`;
}

export async function listWorkspacesForTenant(tenantId: string): Promise<DbWorkspaceInfo[]> {
  if (!sql) return [];
  return await sql<DbWorkspaceInfo[]>`
    SELECT id, name FROM workspace WHERE tenant_id = ${tenantId}
  `;
}
