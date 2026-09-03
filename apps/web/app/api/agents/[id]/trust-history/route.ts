import { listCrossSurfaceTrustHistory } from "@/lib/domains/trust/service";
import { isFeatureEntitled } from "@/lib/entitlements/features";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetAgentTrustHistory(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  if (!(await isFeatureEntitled("crossSurfaceAgentIdentity", tenantId))) {
    return withTraceId(
      Response.json(
        { error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) },
        { status: 402 },
      ),
      traceId,
    );
  }

  const { id: canonicalAgentId } = await params;
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );

  let summary;
  try {
    summary = await listCrossSurfaceTrustHistory({
      canonicalAgentId,
      workspaceId,
      tenantId,
      limit,
    });
  } catch (err) {
    console.error("[agents/[id]/trust-history] listCrossSurfaceTrustHistory failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json({ ...summary, generatedAt: new Date().toISOString(), meta: makeMeta(traceId) }),
    traceId,
  );
}

export { handleGetAgentTrustHistory as GET };
