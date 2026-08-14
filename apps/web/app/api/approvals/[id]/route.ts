import { getApprovalDetail } from "@/lib/domains/review/service";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiApprovalsByid(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  // Documented as a bearer endpoint, and read by the MCP server's
  // spctre://approvals/<id> resource, alongside the queue listing.
  const scope = await resolveRouteScope(request, {
    serviceTokenScope: "approvals:read",
    traceId,
  });
  if (scope instanceof Response) return scope;
  const ctx = scope;

  const { id } = await params;

  const approval = await getApprovalDetail({
    approvalId: id,
    workspaceId: ctx.workspaceId,
    tenantId: ctx.tenantId,
  }).catch(swallow("getApprovalDetail", null));
  if (!approval)
    return withTraceId(
      Response.json({ error: "Approval not found.", meta: makeMeta(traceId) }, { status: 404 }),
      traceId,
    );

  return withTraceId(Response.json({ approval, meta: makeMeta(traceId) }), traceId);
}

export { handleGetApiApprovalsByid as GET };
