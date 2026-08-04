import { listCrossSurfaceHistory } from "@/lib/domains/identity/service";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetAgentIdentityHistory(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json(
        { error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) },
        { status: 402 },
      ),
      traceId,
    );
  }

  const { id: agentId } = await params;
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );

  let history;
  try {
    history = await listCrossSurfaceHistory({ agentId, workspaceId, tenantId, limit });
  } catch (err) {
    console.error("[agents/[id]/identity-history] listCrossSurfaceHistory failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(Response.json({ ...history, meta: makeMeta(traceId) }), traceId);
}

export { handleGetAgentIdentityHistory as GET };
