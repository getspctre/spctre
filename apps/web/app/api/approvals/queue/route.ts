import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { listPendingApprovals } from "@/lib/domains/review/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiApprovalsQueue(request: Request) {
  const traceId = extractTraceId(request);
  let workspaceId: string;
  let tenantId: string;

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "approvals:read");
    if (!tokenAuth.ok) {
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    workspaceId = tokenAuth.auth.workspaceId;
    tenantId = tokenAuth.auth.tenantId;
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) {
      return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    const ctx = await getActiveScope().catch(() => null);
    if (!ctx) {
      return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
    }
    workspaceId = ctx.workspaceId;
    tenantId = ctx.tenantId;
  }

  if (!workspaceId || !tenantId) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

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
