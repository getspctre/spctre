import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { findActorById, requireActorAdminWorkspace } from "@/lib/actors";
import { createAgentBlueprintRevision, getAgentBlueprint, getAgentBlueprintWorkspaceScope, parseAgentBlueprintDefinition, publishBlueprintRevision, setAgentBlueprintRevisionStatus } from "@/lib/domains/agent-blueprints/service";
import { verifyWriteAccess } from "@/lib/demo-guard";
import type { AgentBlueprintStatus } from "@spctre/policy-schema";
import { diffAgentBlueprintRevisions } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function context(request: Request) {
  const traceId = extractTraceId(request);
  const [session, scope] = await Promise.all([getAuthSession().catch(swallow("getAuthSession", null)), getActiveScope().catch(swallow("getActiveScope", null))]);
  if (!session || !scope) return { traceId, response: withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId) };
  return { traceId, session, scope };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(request);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const result = await getAgentBlueprint({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, blueprintId: id });
  if (!result) return withTraceId(Response.json({ error: "Blueprint not found.", meta: makeMeta(auth.traceId) }, { status: 404 }), auth.traceId);
  const compareRevisionId = new URL(request.url).searchParams.get("compareRevisionId")?.trim();
  const baseRevisionId = new URL(request.url).searchParams.get("baseRevisionId")?.trim();
  let diff;
  if (compareRevisionId) {
    const compare = result.revisions.find((revision) => revision.id === compareRevisionId);
    const base = result.revisions.find((revision) => revision.id === (baseRevisionId || compare?.parentRevisionId));
    if (!compare || !base) {
      return withTraceId(Response.json({ error: "Both Blueprint revisions must exist; provide baseRevisionId when the compared revision has no parent.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
    }
    diff = diffAgentBlueprintRevisions({ base, compare });
  }
  return withTraceId(Response.json({ ...result, ...(diff ? { diff } : {}), meta: makeMeta(auth.traceId) }), auth.traceId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(request);
  if ("response" in auth) return auth.response;
  const writeCheck = verifyWriteAccess(auth.scope.tenantId);
  if (!writeCheck.allowed) return withTraceId(Response.json({ error: writeCheck.error || "Write access denied.", meta: makeMeta(auth.traceId) }, { status: 403 }), auth.traceId);
  const { id } = await params;
  const [actor, workspaceScope] = await Promise.all([
    findActorById(auth.session.principalId, { tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId }),
    getAgentBlueprintWorkspaceScope({ tenantId: auth.scope.tenantId, blueprintId: id }),
  ]);
  if (!workspaceScope || workspaceScope.workspace_id !== auth.scope.workspaceId) return withTraceId(Response.json({ error: "Blueprint not found.", meta: makeMeta(auth.traceId) }, { status: 404 }), auth.traceId);
  const admin = actor ? requireActorAdminWorkspace(actor, workspaceScope.workspace_slug ?? "workspace-demo") : { allowed: false };
  if (!admin.allowed) return withTraceId(Response.json({ error: "Admin permission is required to create a Blueprint revision.", meta: makeMeta(auth.traceId) }, { status: 403 }), auth.traceId);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  const record = body as Record<string, unknown>;
  const parsed = parseAgentBlueprintDefinition(record.definition);
  const message = typeof record.message === "string" ? record.message.trim() : "Blueprint revision";
  if (!parsed.definition) return withTraceId(Response.json({ error: parsed.error, meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  const revision = await createAgentBlueprintRevision({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, blueprintId: id, authorId: auth.session.principalId, message, definition: parsed.definition });
  if (!revision) return withTraceId(Response.json({ error: "Blueprint not found or this definition is already committed.", meta: makeMeta(auth.traceId) }, { status: 409 }), auth.traceId);
  return withTraceId(Response.json({ revision, meta: makeMeta(auth.traceId) }, { status: 201 }), auth.traceId);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(request);
  if ("response" in auth) return auth.response;
  const writeCheck = verifyWriteAccess(auth.scope.tenantId);
  if (!writeCheck.allowed) return withTraceId(Response.json({ error: writeCheck.error || "Write access denied.", meta: makeMeta(auth.traceId) }, { status: 403 }), auth.traceId);
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const revisionId = typeof body?.revisionId === "string" ? body.revisionId : "";
  const status = body?.status as AgentBlueprintStatus | undefined;
  if (!revisionId || !status || !["IN_REVIEW", "PUBLISHED"].includes(status)) return withTraceId(Response.json({ error: "revisionId and a valid lifecycle transition are required.", meta: makeMeta(auth.traceId) }, { status: 400 }), auth.traceId);
  const [actor, workspaceScope] = await Promise.all([
    findActorById(auth.session.principalId, { tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId }),
    getAgentBlueprintWorkspaceScope({ tenantId: auth.scope.tenantId, blueprintId: id }),
  ]);
  if (!workspaceScope || workspaceScope.workspace_id !== auth.scope.workspaceId) return withTraceId(Response.json({ error: "Blueprint not found.", meta: makeMeta(auth.traceId) }, { status: 404 }), auth.traceId);
  const admin = actor ? requireActorAdminWorkspace(actor, workspaceScope.workspace_slug ?? "workspace-demo") : { allowed: false };
  if (!admin.allowed) return withTraceId(Response.json({ error: "Admin permission is required to advance a Blueprint lifecycle.", meta: makeMeta(auth.traceId) }, { status: 403 }), auth.traceId);
  const result = status === "PUBLISHED"
    ? await publishBlueprintRevision({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, blueprintId: id, revisionId })
    : { revision: await setAgentBlueprintRevisionStatus({ tenantId: auth.scope.tenantId, workspaceId: auth.scope.workspaceId, blueprintId: id, revisionId, status }) };
  if ("error" in result) return withTraceId(Response.json({ error: result.error, meta: makeMeta(auth.traceId) }, { status: 409 }), auth.traceId);
  const revision = result.revision;
  if (!revision) return withTraceId(Response.json({ error: "Blueprint revision not found or not in the required lifecycle state.", meta: makeMeta(auth.traceId) }, { status: 404 }), auth.traceId);
  return withTraceId(Response.json({ revision, meta: makeMeta(auth.traceId) }), auth.traceId);
}
