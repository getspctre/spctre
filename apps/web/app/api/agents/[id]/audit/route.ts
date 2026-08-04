import { listAgentAuditDecisions } from "@/lib/domains/agents/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiAgentsByidAudit(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  const { id: agentId } = await params;
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );

  let decisions;
  try {
    decisions = await listAgentAuditDecisions({ agentId, workspaceId, tenantId, limit });
  } catch (err) {
    console.error("[agents/[id]/audit] listAgentEvidenceDecisions failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  const allowCount = decisions.filter((d) => d.status === "ALLOW").length;
  const denyCount = decisions.filter((d) => d.status === "DENY").length;
  const warnCount = decisions.filter((d) => d.status === "WARN").length;
  const escalateCount = decisions.filter((d) => d.status === "ESCALATE").length;

  return withTraceId(
    Response.json({
      agentId,
      decisions,
      summary: {
        decisionsAllowed: allowCount,
        decisionsBlocked: denyCount,
        decisionsWarned: warnCount,
        decisionsEscalated: escalateCount,
        complianceStatus: denyCount === 0 && escalateCount === 0 ? "COMPLIANT" : "REVIEW_REQUIRED",
      },
      count: decisions.length,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiAgentsByidAudit as GET };
