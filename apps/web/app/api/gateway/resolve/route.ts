import { getAuthSession } from "@/lib/auth-session";
import {
  GatewayResolveSchema,
  extractTraceId,
  makeMeta,
  parseBody,
  withTraceId,
} from "@spctre/api-contracts";
import { resolveGatewayEscalation } from "@/lib/domains/gateway/service";
import { isDemoTenant } from "@/lib/demo-guard";

import { getActiveScope } from "@/lib/workspace";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handlePostApiGatewayResolve(request: Request) {
  const traceId = extractTraceId(request);
  const started = Date.now();
  return await withSpan("api.gateway.resolve", { "spctre.request_id": traceId, "http.route": "/api/gateway/resolve" }, async () => {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/gateway/resolve", "http.response.status_code": 401 });
    return withTraceId(
      Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }),
      traceId
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/gateway/resolve", "http.response.status_code": 400 });
    return withTraceId(
      Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const parsed = parseBody(GatewayResolveSchema, body);
  if (!parsed.ok) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/gateway/resolve", "http.response.status_code": 400 });
    return withTraceId(
      Response.json({ error: parsed.error, issues: parsed.issues, meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const workspaceContext = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!workspaceContext || !workspaceContext.workspaceId || !workspaceContext.tenantId) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/gateway/resolve", "http.response.status_code": 400 });
    return withTraceId(
      Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  if (isDemoTenant(workspaceContext.tenantId)) {
    return withTraceId(
      Response.json({ error: "Escalation resolution is not available in Demo Mode.", meta: makeMeta(traceId) }, { status: 403 }),
      traceId
    );
  }

  let ok;
  try {
    ok = await resolveGatewayEscalation({
      queueId: parsed.value.queueId,
      tenantId: workspaceContext.tenantId,
      workspaceId: workspaceContext.workspaceId,
      reviewedBy: session.principalId,
      resolutionOutcome: parsed.value.resolutionOutcome,
      resolutionNote: parsed.value.resolutionNote,
      agentGuidance: parsed.value.agentGuidance,
    });
  } catch (err) {
    console.error("[gateway/resolve] resolveEscalationQueueItem failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!ok) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/gateway/resolve", "http.response.status_code": 404 });
    return withTraceId(
      Response.json({ error: "Escalation queue item not found or already resolved.", meta: makeMeta(traceId) }, { status: 404 }),
      traceId
    );
  }

  recordDuration("spctre.gateway.resolve.duration", Date.now() - started, { outcome: parsed.value.resolutionOutcome });
  return withTraceId(Response.json({ ok: true, meta: makeMeta(traceId) }), traceId);
  });
}

export { handlePostApiGatewayResolve as POST };
