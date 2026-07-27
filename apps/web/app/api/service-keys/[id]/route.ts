import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { recordAuthOperation, revokeServiceKeyById } from "@/lib/domains/auth/service";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getActiveScope } from "@/lib/workspace";

export const dynamic = "force-dynamic";

async function handleDeleteApiServiceKeysByid(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = extractTraceId(request);
  const { id } = await params;

  const session = await getAuthSession().catch(() => null);
  if (!session) {
    return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(() => null);
  if (!actor?.reviewerRoles.includes("Admin")) {
    return withTraceId(Response.json({ error: "Admin permission is required.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  }

  const revoked = await revokeServiceKeyById({
    keyId: id,
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  });
  if (revoked === null) {
    return withTraceId(Response.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!revoked) {
    return withTraceId(Response.json({ error: "Key not found or already revoked.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  recordAuthOperation({
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
    eventType: "TOKEN_REVOKED",
    sourceId: id,
    sourceTable: "service_token",
    actorId: session.principalId,
    payload: { keyId: id, revokedAt: new Date().toISOString() },
  }).catch(() => {});

  return withTraceId(new Response(null, { status: 204, headers: { "X-Trace-Id": traceId } }), traceId);
}

export { handleDeleteApiServiceKeysByid as DELETE };
