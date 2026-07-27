import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import {
  DEFAULT_MCP_CONNECTORS,
  DEFAULT_MCP_TOOLS,
  listGovernedMcpCapabilities,
} from "@/lib/domains/mcp/service";

export const dynamic = "force-dynamic";

async function handleGetApiWorkspaceMcpPolicy(request: Request) {
  const traceId = extractTraceId(request);
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim() || request.headers.get("x-spctre-agent-id")?.trim() || undefined;
  const environment = url.searchParams.get("environment")?.trim() || request.headers.get("x-spctre-environment")?.trim() || "production";
  let workspaceContext: { tenantId: string; workspaceId: string };

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "bundle:read");
    if (!tokenAuth.ok) return withTraceId(Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }), traceId);
    workspaceContext = { tenantId: tokenAuth.auth.tenantId, workspaceId: tokenAuth.auth.workspaceId };
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    const scope = await getActiveScope().catch(() => null);
    if (!scope) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
    workspaceContext = scope;
  }

  const capabilities = await listGovernedMcpCapabilities({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    agentId,
    environment,
  });

  return withTraceId(Response.json({
    allowedTools: DEFAULT_MCP_TOOLS,
    allowedConnectors: DEFAULT_MCP_CONNECTORS,
    capabilities,
    registry: {
      workspaceId: workspaceContext.workspaceId,
      agentId,
      environment,
      source: capabilities.some((capability) => capability.grantScope !== "FALLBACK") ? "registry" : "fallback",
    },
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiWorkspaceMcpPolicy as GET };
