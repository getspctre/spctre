import { getAuthSession } from "@/lib/auth-session";
import { getGatewayEscalationStatus } from "@/lib/domains/gateway/service";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiGatewayEscalationStatus(request: Request) {
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
  const decisionId = url.searchParams.get("decisionId");
  if (!decisionId) {
    return withTraceId(Response.json({ error: "decisionId query parameter is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  let status;
  try {
    const result = await getGatewayEscalationStatus({
      decisionId,
      tenantId: workspaceContext.tenantId,
      workspaceId: workspaceContext.workspaceId,
    });
    if ("error" in result) {
      console.error("[gateway/escalations/status] CRITICAL: brokering failed AND could not persist ABORT to decision/escalation rows");
      return withTraceId(Response.json(
        { error: result.error, meta: makeMeta(traceId) },
        { status: 503 }
      ), traceId);
    }
    status = result.status;
  } catch (err) {
    console.error("[gateway/escalations/status] getEscalationStatusByDecisionId failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!status) {
    return withTraceId(Response.json({ error: "Escalation not found for the given decisionId.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  return withTraceId(Response.json({ ...status, meta: makeMeta(traceId) }), traceId);
}

export { handleGetApiGatewayEscalationStatus as GET };
