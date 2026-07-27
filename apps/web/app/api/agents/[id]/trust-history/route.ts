import { listCrossSurfaceTrustHistory } from "@/lib/domains/trust/service";
import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetAgentTrustHistory(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = extractTraceId(request);

  let workspaceId: string;
  let tenantId: string;

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "operations:read");
    if (!tokenAuth.ok) {
      return withTraceId(
        Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }),
        traceId
      );
    }
    workspaceId = tokenAuth.auth.workspaceId;
    tenantId = tokenAuth.auth.tenantId;
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) {
      return withTraceId(
        Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }),
        traceId
      );
    }
    const ctx = await getActiveScope().catch(() => null);
    if (!ctx) {
      return withTraceId(
        Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }),
        traceId
      );
    }
    workspaceId = ctx.workspaceId;
    tenantId = ctx.tenantId;
  }

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json({ error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) }, { status: 402 }),
      traceId
    );
  }

  const { id: canonicalAgentId } = await params;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));

  let summary;
  try {
    summary = await listCrossSurfaceTrustHistory({ canonicalAgentId, workspaceId, tenantId, limit });
  } catch (err) {
    console.error("[agents/[id]/trust-history] listCrossSurfaceTrustHistory failed", err);
    return withTraceId(
      Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }),
      traceId
    );
  }

  return withTraceId(
    Response.json({
      ...summary,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId
  );
}

export { handleGetAgentTrustHistory as GET };
