import { getAuthSession } from "@/lib/auth-session";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { updateGrcDeliveryDestination } from "@/lib/repositories/grc-delivery-destinations";
import { getActiveScope } from "@/lib/workspace";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  const [session, scope, route] = await Promise.all([getAuthSession().catch(() => null), getActiveScope().catch(() => null), params]);
  if (!session || !scope) return withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  const write = verifyWriteAccess(scope.tenantId);
  if (!write.allowed) return withTraceId(Response.json({ error: write.error ?? "Write access denied.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : undefined;
  const credential = typeof body?.credential === "string" && body.credential ? body.credential : undefined;
  if (enabled === undefined && !credential) return withTraceId(Response.json({ error: "enabled or credential is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  const id = await updateGrcDeliveryDestination({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, id: route.id, enabled, credential });
  if (!id) return withTraceId(Response.json({ error: "Destination not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  appendOperationsLog({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, eventType: "GRC_DESTINATION_CONFIGURED", sourceId: id, sourceTable: "grc_delivery_destination", actorId: session.principalId, payload: { action: credential ? "CREDENTIAL_ROTATED" : "ENABLED_CHANGED", enabled, credentialRotated: Boolean(credential) } }).catch(() => {});
  return withTraceId(Response.json({ id, meta: makeMeta(traceId) }), traceId);
}
