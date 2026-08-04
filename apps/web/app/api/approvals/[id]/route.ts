import { getApprovalDetail } from "@/lib/domains/review/service";

import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiApprovalsByid(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session)
    return withTraceId(
      Response.json(
        { error: "Authentication required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );

  const { id } = await params;
  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx)
    return withTraceId(
      Response.json(
        { error: "Workspace context unavailable.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );

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
