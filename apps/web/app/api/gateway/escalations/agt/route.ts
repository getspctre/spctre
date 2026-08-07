import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { registerAgtEscalationRequest } from "@/lib/repositories/gateway/escalations";
import { swallow } from "@/lib/platform/swallow";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const traceId = extractTraceId(request);
  // This is a runtime handoff adjacent to gateway decision persistence, not a
  // policy-evaluation API. Keep its authority aligned with the gateway's
  // evidence-writing runtime token.
  const scope = await resolveRouteScope(request, { serviceTokenScope: "evidence:write", traceId });
  if (scope instanceof Response) return scope;
  const body = await request.json().catch(() => null);
  const decisionId = body && typeof body.decisionId === "string" ? body.decisionId : "";
  const agtRequestId = body && typeof body.agtRequestId === "string" ? body.agtRequestId : "";
  if (!decisionId || !agtRequestId) {
    return withTraceId(
      Response.json(
        { error: "decisionId and agtRequestId are required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }
  const registered = await registerAgtEscalationRequest({
    ...scope,
    decisionId,
    agtRequestId,
  }).catch(swallow("registerAgtEscalationRequest", false, { decisionId, agtRequestId }));
  if (!registered)
    return withTraceId(
      Response.json(
        {
          error: "Open escalation not found or request correlation conflicts.",
          meta: makeMeta(traceId),
        },
        { status: 409 },
      ),
      traceId,
    );
  return withTraceId(
    Response.json(
      { decisionId, agtRequestId, registered: true, meta: makeMeta(traceId) },
      { status: 200 },
    ),
    traceId,
  );
}
