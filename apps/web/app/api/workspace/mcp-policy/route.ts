import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import {
  DEFAULT_MCP_TOOLS,
  listGovernedMcpCapabilities,
  listGovernedMcpConnectors,
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

  // The MCP server enforces this allowlist before it consults the gateway, so
  // a connector missing here is refused without a decision being made. It is
  // resolved from the tenant's installed packs and registered tools rather than
  // from a constant — see listGovernedMcpConnectors. A failure answers 503: the
  // server keeps the policy it already cached, which is better than being told
  // the tenant governs eight runtimes and nothing else.
  let allowedConnectors: string[];
  try {
    allowedConnectors = await listGovernedMcpConnectors({ tenantId, workspaceId });
  } catch (error) {
    console.error("[workspace/mcp-policy] listGovernedMcpConnectors failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json({
      allowedTools: DEFAULT_MCP_TOOLS,
      allowedConnectors,
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
