import { getAuthSession } from "@/lib/auth-session";
import { listGatewayEscalationQueue } from "@/lib/domains/gateway/service";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiGatewayEscalations(request: Request) {
  const traceId = extractTraceId(request);
  let workspaceContext: { workspaceId: string; tenantId: string };

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "operations:read");
    if (!tokenAuth.ok) {
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    workspaceContext = { workspaceId: tokenAuth.auth.workspaceId, tenantId: tokenAuth.auth.tenantId };
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) {
      return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    const ctx = await getActiveScope().catch(() => null);
    if (!ctx) {
      return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
    }
    workspaceContext = ctx;
  }

  if (!workspaceContext.workspaceId || !workspaceContext.tenantId) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  let queue;
  try {
    queue = await listGatewayEscalationQueue({
      workspaceId: workspaceContext.workspaceId,
      tenantId: workspaceContext.tenantId,
      limit,
    });
  } catch (err) {
    console.error("[gateway/escalations] listOpenEscalationQueue failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  return withTraceId(Response.json({
    queue,
    count: queue.length,
    generatedAt: new Date().toISOString(),
    pagination: {
      total: queue.length,
      limit,
      offset: 0,
    },
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiGatewayEscalations as GET };
