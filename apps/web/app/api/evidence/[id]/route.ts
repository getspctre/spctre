import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getEvidenceByDecisionId } from "@/lib/domains/evidence/service";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiEvidenceByid(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  const scope = await resolveRouteScope(request, { serviceTokenScope: "evidence:read", traceId });
  if (scope instanceof Response) return scope;

  const { id } = await params;
  const decisionId = id?.trim();
  if (!decisionId) {
    return withTraceId(
      Response.json(
        { error: "A decision id is required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const evidence = await getEvidenceByDecisionId({
    decisionId,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
  });

  // The read is tenant- and workspace-bound, so a record belonging to another
  // tenant is absent rather than forbidden: answering 403 would confirm that
  // the id exists somewhere.
  if (!evidence) {
    return withTraceId(
      Response.json({ error: "Evidence not found.", meta: makeMeta(traceId) }, { status: 404 }),
      traceId,
    );
  }

  return withTraceId(Response.json({ evidence, meta: makeMeta(traceId) }), traceId);
}

export { handleGetApiEvidenceByid as GET };
