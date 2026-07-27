import { listAgentSurfaces, unlinkAgentSurface } from "@/lib/domains/identity/service";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../../../_route-scope";

export const dynamic = "force-dynamic";

async function handleDeleteAgentSurface(
  request: Request,
  { params }: { params: Promise<{ id: string; surfaceId: string }> }
) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "evidence:write", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId, actorId } = scope;

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json({ error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) }, { status: 402 }),
      traceId
    );
  }

  const { id: canonicalAgentId, surfaceId } = await params;

  const surfaces = await listAgentSurfaces({ tenantId, workspaceId, canonicalAgentId });
  const binding = surfaces.find((s) => s.id === surfaceId);
  if (!binding) {
    return withTraceId(
      Response.json({ error: "Surface binding not found.", meta: makeMeta(traceId) }, { status: 404 }),
      traceId
    );
  }

  const ok = await unlinkAgentSurface({
    bindingId: surfaceId,
    tenantId,
    workspaceId,
    canonicalAgentId,
    surfaceType: binding.surfaceType,
    surfaceAgentId: binding.surfaceAgentId,
    actorId,
  });

  if (!ok) {
    return withTraceId(
      Response.json({ error: "Failed to remove surface binding.", meta: makeMeta(traceId) }, { status: 500 }),
      traceId
    );
  }

  return withTraceId(Response.json({ ok: true, meta: makeMeta(traceId) }), traceId);
}

export { handleDeleteAgentSurface as DELETE };
