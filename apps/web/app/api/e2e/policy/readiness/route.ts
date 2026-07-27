import { evaluatePublishReadiness } from "@spctre/policy-schema";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { getBooleanEnv } from "@/lib/platform/config";
import { getApprovals, getPublishBranchScope } from "@/lib/repositories/policy";
import { getApprovalWorkflowForContext, approvalRulesFromWorkflow } from "@/lib/repositories/approval-workflow";
import { getOpenEscalationSummaryForRevision } from "@/lib/repositories/gateway";
import { getLatestVerificationStatus } from "@/lib/repositories/verification";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

/**
 * E2E support route: get publish readiness for a revision.
 * Applies the same verification-policy and escalation gates as /api/e2e/policy/publish
 * so that readiness.status === "READY" implies publish will succeed.
 * Accepts bearer token (bundle:read) or session cookie.
 *
 * Query: ?branchId=...&revisionId=...
 * Returns: { status, approvals, blockingReasons, requiredRoles,
 *            verificationRequired, escalationsBlocking }
 */
// Accepts bearer token (bundle:read) or session cookie; resolves the scope.
async function resolveE2eReadScope(
  request: Request
): Promise<{ tenantId: string; workspaceId: string } | { error: string; status: number }> {
  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "bundle:read");
    if (!tokenAuth.ok) {
      return { error: tokenAuth.error, status: 401 };
    }
    return { tenantId: tokenAuth.auth.tenantId, workspaceId: tokenAuth.auth.workspaceId };
  }

  const session = await getAuthSession().catch(() => null);
  if (!session) {
    return { error: "Authentication required.", status: 401 };
  }
  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) {
    return { error: "Workspace context unavailable.", status: 400 };
  }
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
}

async function handleGetApiE2ePolicyReadiness(request: Request) {
  const traceId = extractTraceId(request);
  if (!getBooleanEnv("SPCTRE_E2E_API_ENABLED", false)) {
    return withTraceId(Response.json({ error: "E2E support API is disabled.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  const scope = await resolveE2eReadScope(request);
  if ("error" in scope) {
    return withTraceId(Response.json({ error: scope.error, meta: makeMeta(traceId) }, { status: scope.status }), traceId);
  }
  const { tenantId, workspaceId } = scope;

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId")?.trim() ?? "";
  const revisionId = url.searchParams.get("revisionId")?.trim() ?? "";

  if (!branchId) return withTraceId(Response.json({ error: "branchId query param is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  if (!revisionId) return withTraceId(Response.json({ error: "revisionId query param is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  const branchRow = await getPublishBranchScope({ tenantId, branchId }).catch(() => null);
  if (!branchRow) {
    return withTraceId(Response.json({ error: "Branch not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  const approvals = await getApprovals(revisionId, tenantId);
  const approvalWorkflow = await getApprovalWorkflowForContext({
    tenantId,
    workspaceId: branchRow.workspace_id ?? workspaceId,
    environment: branchRow.environment,
  });

  const approvalRules = approvalRulesFromWorkflow(approvalWorkflow);
  const verificationPolicy = approvalWorkflow.verificationPolicy ?? { requireVerification: false };
  const verificationSummary = verificationPolicy.requireVerification
    ? await getLatestVerificationStatus(
        branchRow.workspace_id ?? workspaceId,
        tenantId,
        { revisionId }
      ).catch(() => null)
    : null;

  const readiness = evaluatePublishReadiness({
    branchId,
    revisionId,
    approvalRules,
    approvals,
    verificationSummary: verificationSummary ?? undefined,
    verificationPolicy,
    approvalWorkflow,
  });

  const blockers = [...readiness.blockingReasons];
  let escalationsBlocking = 0;

  if (getBooleanEnv("GATEWAY_ENABLED", false)) {
    const escalationSummary = await getOpenEscalationSummaryForRevision(revisionId, tenantId);
    escalationsBlocking = escalationSummary.count;
    if (escalationSummary.count > 0) {
      const slaHint = escalationSummary.nearestSlaDueAt
        ? ` Nearest SLA due: ${escalationSummary.nearestSlaDueAt}.`
        : "";
      blockers.push({
        message: `${escalationSummary.count} unresolved gateway escalation(s) remain for this revision.${slaHint}`,
        href: "/escalations",
        cta: "View escalations",
      });
    }
  }

  const requiredRoles = approvalRules.map((rule) => rule.role);
  const status = blockers.length > 0 ? "NOT_READY" : readiness.status;

  return withTraceId(Response.json({
    status,
    approvals,
    blockingReasons: blockers.map((b) => b.message),
    requiredRoles,
    verificationRequired: verificationPolicy.requireVerification,
    escalationsBlocking,
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiE2ePolicyReadiness as GET };
