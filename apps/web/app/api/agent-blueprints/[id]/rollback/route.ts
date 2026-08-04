import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { findActorById, requireActorAdminWorkspace } from "@/lib/actors";
import {
  getAgentBlueprintWorkspaceScope,
  rollbackAgentBlueprint,
} from "@/lib/domains/agent-blueprints/service";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  const [session, scope] = await Promise.all([
    getAuthSession().catch(swallow("getAuthSession", null)),
    getActiveScope().catch(swallow("getActiveScope", null)),
  ]);
  if (!session || !scope)
    return withTraceId(
      Response.json(
        { error: "Authentication and workspace context are required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  const writeCheck = verifyWriteAccess(scope.tenantId);
  if (!writeCheck.allowed)
    return withTraceId(
      Response.json(
        { error: writeCheck.error || "Write access denied.", meta: makeMeta(traceId) },
        { status: 403 },
      ),
      traceId,
    );
  const { id: blueprintId } = await params;
  const actor = await findActorById(session.principalId, {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  });
  // Require admin on the Blueprint's real governing workspace, not a hardcoded
  // slug; "workspace-demo" is only the no-workspace/no-DB null-guard.
  const workspaceScope = await getAgentBlueprintWorkspaceScope({
    tenantId: scope.tenantId,
    blueprintId,
  });
  if (!workspaceScope || workspaceScope.workspace_id !== scope.workspaceId)
    return withTraceId(
      Response.json({ error: "Blueprint not found.", meta: makeMeta(traceId) }, { status: 404 }),
      traceId,
    );
  if (
    !actor ||
    !requireActorAdminWorkspace(actor, workspaceScope?.workspace_slug ?? "workspace-demo").allowed
  )
    return withTraceId(
      Response.json(
        {
          error: "Admin permission is required to roll back a Blueprint.",
          meta: makeMeta(traceId),
        },
        { status: 403 },
      ),
      traceId,
    );
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const targetRevisionId =
    typeof body?.targetRevisionId === "string" ? body.targetRevisionId.trim() : "";
  if (!targetRevisionId)
    return withTraceId(
      Response.json(
        { error: "targetRevisionId is required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  const revision = await rollbackAgentBlueprint({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    blueprintId,
    targetRevisionId,
  });
  if (!revision)
    return withTraceId(
      Response.json(
        {
          error: "Only a previously published Blueprint revision can be restored.",
          meta: makeMeta(traceId),
        },
        { status: 409 },
      ),
      traceId,
    );
  appendOperationsLog({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    eventType: "BLUEPRINT_ROLLBACK",
    sourceId: revision.id,
    sourceTable: "agent_blueprint_revision",
    actorId: actor.id,
    payload: {
      blueprintId,
      restoredRevisionId: revision.id,
      definitionHash: revision.definitionHash,
    },
  }).catch(swallow("appendOperationsLog", undefined));
  return withTraceId(Response.json({ revision, meta: makeMeta(traceId) }), traceId);
}
