import { createHash } from "crypto";
import { evaluatePublishReadiness } from "@spctre/policy-schema";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { getBooleanEnv } from "@/lib/platform/config";
import {
  getExistingPublishArtifactHash,
  insertPolicyPublish,
  getApprovals,
  getPublishBranchScope,
  revisionExistsOnPublishBranch,
} from "@/lib/repositories/policy";
import {
  getApprovalWorkflowForContext,
  approvalRulesFromWorkflow,
} from "@/lib/repositories/approval-workflow";
import { getOpenEscalationSummaryForRevision } from "@/lib/repositories/gateway";
import { getLatestVerificationStatus } from "@/lib/repositories/verification";
import { findActorById, getBranchPermissions } from "@/lib/actors";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { e2eApiDisabledResponse } from "../../_shared";
import { swallow } from "@/lib/platform/swallow";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * E2E support route: publish a revision after required approvals are in place.
 * Runs the same readiness check as the product publish flow. Returns a blocking
 * error if approvals are incomplete, preserving the gate semantics.
 *
 * Body: { branchId, revisionId, actorId }
 * Returns: { artifactHash } | { error: string, blockingReasons?: string[] }
 */
type E2eBranchRow = NonNullable<Awaited<ReturnType<typeof getPublishBranchScope>>>;
type E2eActor = NonNullable<Awaited<ReturnType<typeof findActorById>>>;

// Resolve the branch, revision, and actor and check publish permission.
async function authorizeE2ePublish(params: {
  tenantId: string;
  branchId: string;
  revisionId: string;
  actorId: string;
  fallbackWorkspaceId: string;
}): Promise<{ branchRow: E2eBranchRow; actor: E2eActor } | { error: string; status: number }> {
  const { tenantId, branchId, revisionId, actorId } = params;

  const branchRow = await getPublishBranchScope({ tenantId, branchId }).catch(
    swallow("getPublishBranchScope", null),
  );
  if (!branchRow) {
    return { error: "Branch not found.", status: 404 };
  }

  const hasRevision = await revisionExistsOnPublishBranch({
    tenantId,
    branchId,
    revisionId,
    workspaceId: branchRow.workspace_id,
  }).catch(swallow("revisionExistsOnPublishBranch", false));
  if (!hasRevision) {
    return { error: "Revision not found on this branch.", status: 404 };
  }

  const actor = await findActorById(actorId, {
    workspaceId: branchRow.workspace_id ?? params.fallbackWorkspaceId,
    tenantId,
  });
  if (!actor) {
    return { error: "Actor not found.", status: 404 };
  }

  const permissions = getBranchPermissions({
    actor,
    branch: {
      scope: branchRow.scope as "ORGANIZATION" | "WORKSPACE" | "ENVIRONMENT" | "CONNECTOR",
      environment: branchRow.environment ?? undefined,
    },
    workspaceSlug: branchRow.workspace_slug ?? "workspace-demo",
  });
  if (!permissions.canPublish) {
    return { error: permissions.publishReason ?? "Actor cannot publish this branch.", status: 403 };
  }

  return { branchRow, actor };
}

// Same readiness gates as the product publish flow. Returns blocking reasons
// when the revision is not publishable yet.
async function checkE2ePublishReadiness(params: {
  tenantId: string;
  branchId: string;
  revisionId: string;
  workspaceId: string;
  environment: string | null;
}): Promise<{ error: string; blockingReasons: string[] } | null> {
  const { tenantId, branchId, revisionId } = params;
  const approvals = await getApprovals(revisionId, tenantId);
  const approvalWorkflow = await getApprovalWorkflowForContext({
    tenantId,
    workspaceId: params.workspaceId,
    environment: params.environment,
  });

  const verificationPolicy = approvalWorkflow.verificationPolicy ?? { requireVerification: false };
  const verificationSummary = verificationPolicy.requireVerification
    ? await getLatestVerificationStatus(params.workspaceId, tenantId, { revisionId }).catch(
        swallow("getLatestVerificationStatus", null),
      )
    : null;

  const readiness = evaluatePublishReadiness({
    branchId,
    revisionId,
    approvalRules: approvalRulesFromWorkflow(approvalWorkflow),
    approvals,
    verificationSummary: verificationSummary ?? undefined,
    verificationPolicy,
    approvalWorkflow,
  });

  if (readiness.status !== "READY") {
    return {
      error: readiness.blockingReasons.map((b) => b.message).join(" "),
      blockingReasons: readiness.blockingReasons.map((b) => b.message),
    };
  }

  if (getBooleanEnv("GATEWAY_ENABLED", false)) {
    const escalationSummary = await getOpenEscalationSummaryForRevision(revisionId, tenantId);
    if (escalationSummary.count > 0) {
      const slaHint = escalationSummary.nearestSlaDueAt
        ? ` Nearest SLA due: ${escalationSummary.nearestSlaDueAt}.`
        : "";
      return {
        error: `Publish is blocked: ${escalationSummary.count} unresolved gateway escalation(s) remain for this revision.${slaHint}`,
        blockingReasons: [`${escalationSummary.count} unresolved gateway escalation(s).`],
      };
    }
  }

  return null;
}

async function handlePostApiE2ePolicyPublish(request: Request) {
  const traceId = extractTraceId(request);
  const disabled = e2eApiDisabledResponse(traceId);
  if (disabled) return disabled;

  const tokenAuth = await authenticateServiceToken(request, "e2e:write");
  if (!tokenAuth.ok) {
    return withTraceId(
      Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(
      Response.json(
        { error: "Request body must be an object.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const rec = body as Record<string, unknown>;
  const branchId = typeof rec.branchId === "string" ? rec.branchId.trim() : "";
  const revisionId = typeof rec.revisionId === "string" ? rec.revisionId.trim() : "";
  const actorId = typeof rec.actorId === "string" ? rec.actorId.trim() : "";

  if (!branchId)
    return withTraceId(
      Response.json({ error: "branchId is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  if (!revisionId)
    return withTraceId(
      Response.json({ error: "revisionId is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  if (!actorId)
    return withTraceId(
      Response.json({ error: "actorId is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );

  const tenantId = tokenAuth.auth.tenantId;

  const authorized = await runWithTenantContext(tenantId, () =>
    authorizeE2ePublish({
      tenantId,
      branchId,
      revisionId,
      actorId,
      fallbackWorkspaceId: tokenAuth.auth.workspaceId,
    }),
  );
  if ("error" in authorized) {
    return withTraceId(
      Response.json(
        { error: authorized.error, meta: makeMeta(traceId) },
        { status: authorized.status },
      ),
      traceId,
    );
  }
  const { branchRow, actor } = authorized;

  const blocking = await runWithTenantContext(tenantId, () =>
    checkE2ePublishReadiness({
      tenantId,
      branchId,
      revisionId,
      workspaceId: branchRow.workspace_id ?? tokenAuth.auth.workspaceId,
      environment: branchRow.environment,
    }),
  );
  if (blocking) {
    return withTraceId(
      Response.json(
        {
          error: blocking.error,
          blockingReasons: blocking.blockingReasons,
          meta: makeMeta(traceId),
        },
        { status: 422 },
      ),
      traceId,
    );
  }

  const existingArtifactHash = await runWithTenantContext(tenantId, () =>
    getExistingPublishArtifactHash({ tenantId, branchId, revisionId }),
  );
  if (existingArtifactHash) {
    return withTraceId(
      Response.json({ artifactHash: existingArtifactHash, meta: makeMeta(traceId) }),
      traceId,
    );
  }

  const artifactHash = `sha256:${createHash("sha256")
    .update(`${revisionId}-${Date.now()}`)
    .digest("hex")
    .slice(0, 16)}`;

  try {
    await runWithTenantContext(tenantId, () =>
      insertPolicyPublish({ tenantId, branchId, revisionId, artifactHash, actorId: actor.id }),
    );
  } catch (error) {
    console.error("[e2e/policy/publish] failed:", error);
    return withTraceId(
      Response.json(
        { error: "An unexpected error occurred.", meta: makeMeta(traceId) },
        { status: 500 },
      ),
      traceId,
    );
  }

  return withTraceId(Response.json({ artifactHash, meta: makeMeta(traceId) }), traceId);
}

export { handlePostApiE2ePolicyPublish as POST };
