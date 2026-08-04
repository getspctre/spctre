import { getGatewayEscalationStatus } from "@/lib/domains/gateway/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiGatewayEscalationStatus(request: Request) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  const url = new URL(request.url);
  const decisionId = url.searchParams.get("decisionId");
  if (!decisionId) {
    return withTraceId(
      Response.json(
        { error: "decisionId query parameter is required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  let status;
  try {
    const result = await getGatewayEscalationStatus({ decisionId, tenantId, workspaceId });
    if ("error" in result) {
      console.error(
        "[gateway/escalations/status] CRITICAL: brokering failed AND could not persist ABORT to decision/escalation rows",
      );
      return withTraceId(
        Response.json({ error: result.error, meta: makeMeta(traceId) }, { status: 503 }),
        traceId,
      );
    }
    status = result.status;
  } catch (err) {
    console.error("[gateway/escalations/status] getEscalationStatusByDecisionId failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  if (!status) {
    return withTraceId(
      Response.json(
        { error: "Escalation not found for the given decisionId.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }

  return withTraceId(Response.json({ ...status, meta: makeMeta(traceId) }), traceId);
}

export { handleGetApiGatewayEscalationStatus as GET };
