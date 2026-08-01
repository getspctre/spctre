import {
  DEFAULT_MCP_CONNECTORS,
  DEFAULT_MCP_TOOLS,
  listGovernedMcpCapabilities as listGovernedMcpCapabilitiesInTenant,
} from "@/lib/repositories/workspace/mcp-registry";
import { runWithTenantContext } from "@/lib/tenant-context";

export { DEFAULT_MCP_CONNECTORS, DEFAULT_MCP_TOOLS };

export async function listGovernedMcpCapabilities(params: Parameters<typeof listGovernedMcpCapabilitiesInTenant>[0]) {
  return runWithTenantContext(params.tenantId, () => listGovernedMcpCapabilitiesInTenant(params));
}
