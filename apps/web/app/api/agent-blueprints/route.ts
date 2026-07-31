import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { createAgentBlueprint, listAgentBlueprints, parseAgentBlueprintDefinition } from "@/lib/domains/agent-blueprints/service";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function context(request: Request) {
  const traceId = extractTraceId(request);
  const [session, scope] = await Promise.all([getAuthSession().catch(swallow("getAuthSession", null)), getActiveScope().catch(swallow("getActiveScope", null))]);
  if (!session || !scope) return { traceId, response: withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId) };
  return { traceId, session, scope };
}

export async function GET(request: Request) {
  const auth = await context(request);
  if ("response" in auth) return auth.response;
  const blueprints = await listAgentBlueprints({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId });
  return withTraceId(Response.json({ blueprints, meta: makeMeta(auth.traceId) }), auth.traceId);
}

export async function POST(request: Request) {
  const auth = await context(request);
  if ("response" in auth) return auth.response;
  const writeCheck = verifyWriteAccess(auth.scope.tenantId);
  if (!writeCheck.allowed) return withTraceId(Response.json({ error: writeCheck.error || "Write access denied.", meta: makeMeta(auth.traceId) }, { status: 403 }), auth.traceId);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  }
  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  const message = typeof record.message === "string" ? record.message.trim() : "Initial blueprint revision";
  const parsed = parseAgentBlueprintDefinition(record.definition);
  if (!name || !agentId || !parsed.definition) {
    return withTraceId(Response.json({ error: parsed.error ?? "name and agentId are required.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  }
  const blueprint = await createAgentBlueprint({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, name, agentId, message, definition: parsed.definition, authorId: auth.session.principalId });
  if (!blueprint) return withTraceId(Response.json({ error: "Blueprint could not be created; its name or agent may already be governed.", meta: makeMeta(auth.traceId) }, { status: 409 }), auth.traceId);
  return withTraceId(Response.json({ blueprint, meta: makeMeta(auth.traceId) }, { status: 201 }), auth.traceId);
}
