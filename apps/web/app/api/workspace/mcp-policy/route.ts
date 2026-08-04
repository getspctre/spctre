import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import {
  DEFAULT_MCP_CONNECTORS,
  DEFAULT_MCP_TOOLS,
  listGovernedMcpCapabilities,
} from "@/lib/domains/mcp/service";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiWorkspaceMcpPolicy(request: Request) {
  const traceId = extractTraceId(request);
  const url = new URL(request.url);
  const agentId =
    url.searchParams.get("agentId")?.trim() ||
    request.headers.get("x-spctre-agent-id")?.trim() ||
    undefined;
  const environment =
    url.searchParams.get("environment")?.trim() ||
    request.headers.get("x-spctre-environment")?.trim() ||
    "production";

  const scope = await resolveRouteScope(request, { serviceTokenScope: "bundle:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  const capabilities = await listGovernedMcpCapabilities({
    tenantId,
    workspaceId,
    agentId,
    environment,
  });

  return withTraceId(
    Response.json({
      allowedTools: DEFAULT_MCP_TOOLS,
      allowedConnectors: DEFAULT_MCP_CONNECTORS,
      capabilities,
      registry: {
        workspaceId,
        agentId,
        environment,
        source: capabilities.some((capability) => capability.grantScope !== "FALLBACK")
          ? "registry"
          : "fallback",
      },
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiWorkspaceMcpPolicy as GET };
