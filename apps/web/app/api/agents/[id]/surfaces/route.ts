import { linkAgentSurface, listAgentSurfaces } from "@/lib/domains/identity/service";
import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import type { AgentSurfaceType } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { asString } from "../../../_shared";

export const dynamic = "force-dynamic";

async function resolveWorkspaceContext(
  request: Request,
  scope: "operations:read" | "evidence:write"
): Promise<
  | { ok: true; workspaceId: string; tenantId: string; actorId: string }
  | { ok: false; response: Response }
> {
  const traceId = extractTraceId(request);
  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, scope);
    if (!tokenAuth.ok) {
      return {
        ok: false,
        response: withTraceId(
          Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }),
          traceId
        ),
      };
    }
    return { ok: true, workspaceId: tokenAuth.auth.workspaceId, tenantId: tokenAuth.auth.tenantId, actorId: tokenAuth.auth.principalId };
  }
  const session = await getAuthSession().catch(() => null);
  if (!session) {
    return {
      ok: false,
      response: withTraceId(
        Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }),
        traceId
      ),
    };
  }
  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) {
    return {
      ok: false,
      response: withTraceId(
        Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }),
        traceId
      ),
    };
  }
  return { ok: true, workspaceId: ctx.workspaceId, tenantId: ctx.tenantId, actorId: session.principalId };
}

async function handleGetAgentSurfaces(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = extractTraceId(request);
  const auth = await resolveWorkspaceContext(request, "operations:read");
  if (!auth.ok) return auth.response;

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json({ error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) }, { status: 402 }),
      traceId
    );
  }

  const { id: canonicalAgentId } = await params;
  const surfaces = await listAgentSurfaces({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    canonicalAgentId,
  });

  return withTraceId(
    Response.json({ canonicalAgentId, surfaces, count: surfaces.length, meta: makeMeta(traceId) }),
    traceId
  );
}

async function handlePostAgentSurface(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = extractTraceId(request);
  const auth = await resolveWorkspaceContext(request, "evidence:write");
  if (!auth.ok) return auth.response;

  if (!isFeatureEnabled("crossSurfaceAgentIdentity")) {
    return withTraceId(
      Response.json({ error: "Cross-surface agent identity requires a Cloud plan.", meta: makeMeta(traceId) }, { status: 402 }),
      traceId
    );
  }

  const { id: canonicalAgentId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(
      Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const rec = body as Record<string, unknown>;
  const surfaceType = asString(rec.surfaceType) as AgentSurfaceType | undefined;
  const surfaceAgentId = asString(rec.surfaceAgentId);

  if (!surfaceType) {
    return withTraceId(
      Response.json({ error: "surfaceType is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }
  if (!surfaceAgentId) {
    return withTraceId(
      Response.json({ error: "surfaceAgentId is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const binding = await linkAgentSurface({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    canonicalAgentId,
    surfaceType,
    surfaceAgentId,
    actorId: auth.actorId,
  });

  if (!binding) {
    return withTraceId(
      Response.json({ error: "Surface binding already exists or could not be created.", meta: makeMeta(traceId) }, { status: 409 }),
      traceId
    );
  }

  return withTraceId(Response.json({ binding, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handleGetAgentSurfaces as GET, handlePostAgentSurface as POST };
