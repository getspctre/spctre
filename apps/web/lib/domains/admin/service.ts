import { queryAuditLogs } from "@/lib/repositories/audit";
import { listAllTenants, listWorkspacesForTenant } from "@/lib/repositories/hitl-worker";

export async function queryAdminAuditLogs(params: Parameters<typeof queryAuditLogs>[0]) {
  return queryAuditLogs(params);
}

export async function listHitlTenants() {
  return listAllTenants();
}

export async function listHitlTenantWorkspaces(tenantId: string) {
  return listWorkspacesForTenant(tenantId);
}
