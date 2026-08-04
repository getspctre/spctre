import { getAuthSession } from "@/lib/auth-session";
import {
  authenticateServiceToken,
  hasBearerToken,
  type ServiceTokenScope,
} from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export interface RouteScope {
  tenantId: string;
  workspaceId: string;
  actorId: string;
}

export async function resolveRouteScope(
  request: Request,
  params: {
    serviceTokenScope: ServiceTokenScope;
    traceId: string;
    /**
     * Status returned when a request authenticates but no workspace context can
     * be resolved ("Workspace context unavailable."). Defaults to 400. Routes
     * that historically mapped every auth failure to 401 (e.g. POST
     * /api/verification) pass 401 to preserve their public contract.
     */
    contextUnavailableStatus?: number;
  },
): Promise<RouteScope | Response> {
  const contextUnavailableStatus = params.contextUnavailableStatus ?? 400;
  let workspaceId: string;
  let tenantId: string;
  let actorId = "";

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, params.serviceTokenScope);
    if (!tokenAuth.ok) {
      // Surface the granular reason (e.g. "Token is missing bundle:read scope.")
      // so callers learn which scope is required, matching the pre-helper routes.
      return routeScopeError(tokenAuth.error, 401, params.traceId);
    }
    workspaceId = tokenAuth.auth.workspaceId;
    tenantId = tokenAuth.auth.tenantId;
    actorId = tokenAuth.auth.principalId;
  } else {
    const session = await getAuthSession().catch(swallow("getAuthSession", null));
    if (!session) {
      return routeScopeError("Authentication required.", 401, params.traceId);
    }
    const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
    if (!ctx) {
      return routeScopeError(
        "Workspace context unavailable.",
        contextUnavailableStatus,
        params.traceId,
      );
    }
    workspaceId = ctx.workspaceId;
    tenantId = ctx.tenantId;
    actorId = session.principalId;
  }

  if (!workspaceId || !tenantId) {
    return routeScopeError(
      "Workspace context unavailable.",
      contextUnavailableStatus,
      params.traceId,
    );
  }

  return { tenantId, workspaceId, actorId };
}

function routeScopeError(error: string, status: number, traceId: string): Response {
  return withTraceId(Response.json({ error, meta: makeMeta(traceId) }, { status }), traceId);
}
