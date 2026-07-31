import { getAuthSession } from "@/lib/auth-session";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { createGrcDeliveryDestination, listGrcDeliveryDestinations, type GrcDeliveryDestination } from "@/lib/repositories/grc-delivery-destinations";
import { getActiveScope } from "@/lib/workspace";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";
const KINDS = new Set<GrcDeliveryDestination["kind"]>(["webhook"]);

async function context(request: Request) {
  const traceId = extractTraceId(request);
  const [session, scope] = await Promise.all([getAuthSession().catch(swallow("getAuthSession", null)), getActiveScope().catch(swallow("getActiveScope", null))]);
  if (!session || !scope) return { traceId, response: withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId) };
  return { traceId, session, scope };
}

export async function GET(request: Request) {
  const auth = await context(request); if ("response" in auth) return auth.response;
  const destinations = await listGrcDeliveryDestinations({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId });
  return withTraceId(Response.json({ destinations, meta: makeMeta(auth.traceId) }), auth.traceId);
}

export async function POST(request: Request) {
  const auth = await context(request); if ("response" in auth) return auth.response;
  const write = verifyWriteAccess(auth.scope.tenantId);
  if (!write.allowed) return withTraceId(Response.json({ error: write.error ?? "Write access denied.", meta: makeMeta(auth.traceId) }, { status: 403 }), auth.traceId);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kind = typeof body?.kind === "string" && KINDS.has(body.kind as GrcDeliveryDestination["kind"]) ? body.kind as GrcDeliveryDestination["kind"] : null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const credential = typeof body?.credential === "string" ? body.credential : undefined;
  if (!kind || !endpoint || !label) return withTraceId(Response.json({ error: "kind, HTTPS endpoint, and label are required.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  try {
    const id = await createGrcDeliveryDestination({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, kind, endpoint, label, credential, createdBy: auth.session.principalId });
    appendOperationsLog({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, eventType: "GRC_DESTINATION_CONFIGURED", sourceId: id, sourceTable: "grc_delivery_destination", actorId: auth.session.principalId, payload: { action: "CREATED", kind, endpoint, label, hasCredential: Boolean(credential) } }).catch(swallow("appendOperationsLog", undefined));
    return withTraceId(Response.json({ id, meta: makeMeta(auth.traceId) }, { status: 201 }), auth.traceId);
  } catch (error) {
    return withTraceId(Response.json({ error: error instanceof Error ? error.message : "Destination could not be created.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  }
}
