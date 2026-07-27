import { getAuthSession } from "@/lib/auth-session";
import { authenticateServiceToken, hasBearerToken, type ServiceTokenScope } from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { makeMeta, withTraceId } from "@spctre/api-contracts";

export interface RouteScope {
  tenantId: string;
  workspaceId: string;
  actorId: string;
}

export async function resolveRouteScope(
  request: Request,
  params: { serviceTokenScope: ServiceTokenScope; traceId: string }
): Promise<RouteScope | Response> {
  let workspaceId: string;
  let tenantId: string;
  let actorId = "";

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, params.serviceTokenScope);
    if (!tokenAuth.ok) {
      return routeScopeError("Invalid or expired service token.", 401, params.traceId);
    }
    workspaceId = tokenAuth.auth.workspaceId;
    tenantId = tokenAuth.auth.tenantId;
    actorId = tokenAuth.auth.principalId;
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) {
      return routeScopeError("Authentication required.", 401, params.traceId);
    }
    const ctx = await getActiveScope().catch(() => null);
    if (!ctx) {
      return routeScopeError("Workspace context unavailable.", 400, params.traceId);
    }
    workspaceId = ctx.workspaceId;
    tenantId = ctx.tenantId;
    actorId = session.principalId;
  }

  if (!workspaceId || !tenantId) {
    return routeScopeError("Workspace context unavailable.", 400, params.traceId);
  }

  return { tenantId, workspaceId, actorId };
}

function routeScopeError(error: string, status: number, traceId: string): Response {
  return withTraceId(Response.json({ error, meta: makeMeta(traceId) }, { status }), traceId);
}
