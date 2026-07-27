import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { listWorkspaceApiSummaries } from "@/lib/domains/workspace/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiWorkspaces(request: Request) {
  const traceId = extractTraceId(request);
  let tenantId: string;

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "workspaces:read");
    if (!tokenAuth.ok) {
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
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
    tenantId = ctx.tenantId;
  }

  if (!tenantId) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  let results;
  try {
    results = await listWorkspaceApiSummaries(tenantId);
  } catch (err) {
    console.error("[workspaces] listWorkspaceApiSummaries failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  return withTraceId(Response.json({
    workspaces: results,
    count: results.length,
    generatedAt: new Date().toISOString(),
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiWorkspaces as GET };
