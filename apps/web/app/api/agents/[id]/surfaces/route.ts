import { linkAgentSurface, listAgentSurfaces } from "@/lib/domains/identity/service";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import type { AgentSurfaceType } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { asString } from "../../../_shared";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetAgentSurfaces(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json(
        { error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) },
        { status: 402 },
      ),
      traceId,
    );
  }

  const { id: canonicalAgentId } = await params;
  const surfaces = await listAgentSurfaces({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    canonicalAgentId,
  });

  return withTraceId(
    Response.json({ canonicalAgentId, surfaces, count: surfaces.length, meta: makeMeta(traceId) }),
    traceId,
  );
}

async function handlePostAgentSurface(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  const scope = await resolveRouteScope(request, { serviceTokenScope: "evidence:write", traceId });
  if (scope instanceof Response) return scope;

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json(
        { error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) },
        { status: 402 },
      ),
      traceId,
    );
  }

  const { id: canonicalAgentId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(
      Response.json(
        { error: "Request body must be an object.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const rec = body as Record<string, unknown>;
  const surfaceType = asString(rec.surfaceType) as AgentSurfaceType | undefined;
  const surfaceAgentId = asString(rec.surfaceAgentId);

  if (!surfaceType) {
    return withTraceId(
      Response.json(
        { error: "surfaceType is required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }
  if (!surfaceAgentId) {
    return withTraceId(
      Response.json(
        { error: "surfaceAgentId is required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const binding = await linkAgentSurface({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    canonicalAgentId,
    surfaceType,
    surfaceAgentId,
    actorId: scope.actorId,
  });

  if (!binding) {
    return withTraceId(
      Response.json(
        {
          error: "Surface binding already exists or could not be created.",
          meta: makeMeta(traceId),
        },
        { status: 409 },
      ),
      traceId,
    );
  }

  return withTraceId(Response.json({ binding, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handleGetAgentSurfaces as GET, handlePostAgentSurface as POST };
