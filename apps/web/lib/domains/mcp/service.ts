import {
  DEFAULT_MCP_CONNECTORS,
  DEFAULT_MCP_TOOLS,
  grantMcpTool as grantMcpToolInTenant,
  listGovernedMcpCapabilities as listGovernedMcpCapabilitiesInTenant,
  listGovernedMcpConnectors as listGovernedMcpConnectorsInTenant,
  listMcpToolRegistry as listMcpToolRegistryInTenant,
  registerMcpTool as registerMcpToolInTenant,
  revokeMcpToolGrant as revokeMcpToolGrantInTenant,
  type McpToolGrantRecord,
  type McpToolRegistryEntry,
} from "@/lib/repositories/workspace/mcp-registry";
import { runWithTenantContext } from "@/lib/tenant-context";

export { DEFAULT_MCP_CONNECTORS, DEFAULT_MCP_TOOLS };
export type { McpToolGrantRecord, McpToolRegistryEntry };

export async function listGovernedMcpCapabilities(
  params: Parameters<typeof listGovernedMcpCapabilitiesInTenant>[0],
) {
  return runWithTenantContext(params.tenantId, () => listGovernedMcpCapabilitiesInTenant(params));
}

export async function listGovernedMcpConnectors(
  params: Parameters<typeof listGovernedMcpConnectorsInTenant>[0],
) {
  return runWithTenantContext(params.tenantId, () => listGovernedMcpConnectorsInTenant(params));
}

export async function listMcpToolRegistry(
  params: Parameters<typeof listMcpToolRegistryInTenant>[0],
): Promise<McpToolRegistryEntry[]> {
  return runWithTenantContext(params.tenantId, () => listMcpToolRegistryInTenant(params));
}

// ── Governance acts ───────────────────────────────────────────────────────────
//
// Each of these writes its operations-log entry in the same transaction as the
// row it describes, in the repository: a registry change that cannot be audited
// does not commit. See lib/repositories/workspace/mcp-registry.ts.

export async function registerMcpTool(
  params: Parameters<typeof registerMcpToolInTenant>[0],
): Promise<{ id: string; created: boolean }> {
  return runWithTenantContext(params.tenantId, () => registerMcpToolInTenant(params));
}

export async function grantMcpToolCapability(
  params: Parameters<typeof grantMcpToolInTenant>[0],
): Promise<McpToolGrantRecord> {
  return runWithTenantContext(params.tenantId, () => grantMcpToolInTenant(params));
}

export async function revokeMcpToolCapability(
  params: Parameters<typeof revokeMcpToolGrantInTenant>[0],
): Promise<boolean> {
  return runWithTenantContext(params.tenantId, () => revokeMcpToolGrantInTenant(params));
}
