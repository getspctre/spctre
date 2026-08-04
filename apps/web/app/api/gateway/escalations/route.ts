import { listGatewayEscalationQueue } from "@/lib/domains/gateway/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiGatewayEscalations(request: Request) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );

  let queue;
  try {
    queue = await listGatewayEscalationQueue({ workspaceId, tenantId, limit });
  } catch (err) {
    console.error("[gateway/escalations] listOpenEscalationQueue failed", err);
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
      queue,
      count: queue.length,
      generatedAt: new Date().toISOString(),
      pagination: { total: queue.length, limit, offset: 0 },
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiGatewayEscalations as GET };
