import { listAgentAuditDecisions } from "@/lib/domains/agents/service";
import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";

export const dynamic = "force-dynamic";

async function handleGetApiAgentsByidAudit(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  let workspaceContext: { workspaceId: string; tenantId: string };

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "operations:read");
    if (!tokenAuth.ok) {
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    workspaceContext = { workspaceId: tokenAuth.auth.workspaceId, tenantId: tokenAuth.auth.tenantId };
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    const ctx = await getActiveScope().catch(() => null);
    if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
    workspaceContext = ctx;
  }

  const { id: agentId } = await params;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  let decisions;
  try {
    decisions = await listAgentAuditDecisions({ agentId, workspaceId: workspaceContext.workspaceId, tenantId: workspaceContext.tenantId, limit });
  } catch (err) {
    console.error("[agents/[id]/audit] listAgentEvidenceDecisions failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  const allowCount = decisions.filter((d) => d.status === "ALLOW").length;
  const denyCount = decisions.filter((d) => d.status === "DENY").length;
  const warnCount = decisions.filter((d) => d.status === "WARN").length;
  const escalateCount = decisions.filter((d) => d.status === "ESCALATE").length;

  return withTraceId(Response.json({
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
  }), traceId);
}

export { handleGetApiAgentsByidAudit as GET };
