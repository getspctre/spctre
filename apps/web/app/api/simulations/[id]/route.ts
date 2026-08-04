import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getAuthSession } from "@/lib/auth-session";
import { getSimulationRunReview } from "@/lib/repositories/evidence";
import { getActiveScope } from "@/lib/workspace";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  const [session, scope] = await Promise.all([
    getAuthSession().catch(swallow("getAuthSession", null)),
    getActiveScope().catch(swallow("getActiveScope", null)),
  ]);
  if (!session || !scope) {
    return withTraceId(
      Response.json(
        { error: "Authentication and workspace context are required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  }

  const { id } = await params;
  const simulation = await getSimulationRunReview({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    simulationRunId: id,
  }).catch(swallow("getSimulationRunReview", null));
  if (!simulation) {
    return withTraceId(
      Response.json(
        { error: "Simulation run not found.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }
  return withTraceId(Response.json({ simulation, meta: makeMeta(traceId) }), traceId);
}
