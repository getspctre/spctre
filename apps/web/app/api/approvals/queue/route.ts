import { listPendingApprovals } from "@/lib/domains/review/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiApprovalsQueue(request: Request) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "approvals:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  let queue;
  try {
    queue = await listPendingApprovals({ workspaceId, tenantId });
  } catch (err) {
    console.error("[approvals/queue] listPendingApprovalQueue failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  return withTraceId(Response.json({
    queue,
    count: queue.length,
    generatedAt: new Date().toISOString(),
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiApprovalsQueue as GET };
