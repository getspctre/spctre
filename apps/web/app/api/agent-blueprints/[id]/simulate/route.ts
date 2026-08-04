import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { simulateAgentBlueprintRevision } from "@/lib/domains/agent-blueprints/service";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
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
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const revisionId = typeof body?.revisionId === "string" ? body.revisionId : "";
  if (!revisionId)
    return withTraceId(
      Response.json({ error: "revisionId is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  const { id: blueprintId } = await params;
  const simulation = await simulateAgentBlueprintRevision({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    blueprintId,
    revisionId,
  });
  if (!simulation)
    return withTraceId(
      Response.json(
        { error: "Blueprint revision not found.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  appendOperationsLog({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    eventType: "SIMULATION_RUN",
    sourceId: revisionId,
    sourceTable: "agent_blueprint_revision",
    actorId: session.principalId,
    payload: { blueprintId, ...simulation },
  }).catch(swallow("appendOperationsLog", undefined));
  return withTraceId(Response.json({ simulation, meta: makeMeta(traceId) }), traceId);
}
