import { createHash } from "crypto";
import { logger } from "@spctre/platform/logging";
import { evaluatePublishReadiness } from "@spctre/policy-schema";
import { getBranchPermissions, getActiveActor } from "@/lib/actors";
import type { ActiveScope } from "@/lib/workspace";
import { getBooleanEnv } from "@/lib/platform/config";
import { recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import {
  getApprovals,
  getExistingPublishArtifactHash,
  getPublishBranchScope,
  getRulesForRevision,
  insertPolicyPublish,
  revisionExistsOnPublishBranch,
} from "@/lib/repositories/policy";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  approvalRulesFromWorkflow,
  getApprovalWorkflowForContext,
} from "@/lib/repositories/approval-workflow";
import { getLatestVerificationStatus } from "@/lib/repositories/verification";
import { insertAuthorizationDenialEvent } from "@/lib/repositories/workspace";
import { getOpenEscalationSummaryForRevision } from "@/lib/repositories/gateway";
import {
  getLatestManagedSimulationRegression,
  countRuntimeEvidence,
} from "@/lib/repositories/evidence";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { swallow } from "@/lib/platform/swallow";

export interface PublishRevisionInput {
  revisionId: string;
  branchId: string;
}

export type PublishRevisionResult = { artifactHash: string } | { error: string };

type PublishBranchRow = NonNullable<Awaited<ReturnType<typeof getPublishBranchScope>>>;
type PublishActor = Awaited<ReturnType<typeof getActiveActor>>["actor"];

// Validate the branch/revision exist and the actor may publish. Returns the
// resolved context, or an error result to surface directly.
async function authorizePublish(
  input: PublishRevisionInput,
  scope: ActiveScope,
): Promise<{ branchRow: PublishBranchRow; actor: PublishActor } | { error: string }> {
  const tenantId = scope.tenantId;

  const branchRow = await getPublishBranchScope({ tenantId, branchId: input.branchId });
  if (!branchRow) return { error: "Branch not found." };

  const hasRevision = await revisionExistsOnPublishBranch({
    tenantId,
    branchId: input.branchId,
    revisionId: input.revisionId,
    workspaceId: branchRow.workspace_id,
  });
  if (!hasRevision) return { error: "Revision not found on this branch." };

  const { actor } = await getActiveActor({
    workspaceId: branchRow.workspace_id ?? scope.workspaceId,
    tenantId,
  });

  const permissions = getBranchPermissions({
    actor,
    branch: {
      scope: branchRow.scope as "ORGANIZATION" | "WORKSPACE" | "ENVIRONMENT" | "CONNECTOR",
      environment: branchRow.environment ?? undefined,
    },
    workspaceSlug: branchRow.workspace_slug ?? "workspace-demo",
  });
  if (!permissions.canPublish) {
    await insertAuthorizationDenialEvent({
      tenantId,
      action: "publish.execute",
      reason: permissions.publishReason ?? "Publish is not allowed.",
      resourceType: "policy_branch",
      resourceId: input.branchId,
      principalId: actor.id,
      workspaceId: branchRow.workspace_id,
    });
    return { error: permissions.publishReason ?? "Publish is not allowed." };
  }

  return { branchRow, actor };
}

// Approval/verification readiness plus the gateway-escalation gate. Returns an
// error message when the revision is not publishable yet.
async function checkPublishReadiness(
  input: PublishRevisionInput,
  scope: ActiveScope,
  branchRow: PublishBranchRow,
): Promise<string | null> {
  const tenantId = scope.tenantId;
  const [rules, approvals, approvalWorkflow] = await Promise.all([
    getRulesForRevision(input.revisionId, tenantId),
    getApprovals(input.revisionId, tenantId),
    getApprovalWorkflowForContext({
      tenantId,
      workspaceId: branchRow.workspace_id ?? scope.workspaceId,
      environment: branchRow.environment,
    }),
  ]);
  if (rules.length === 0) {
    return "Publish is blocked: a policy revision must contain at least one rule.";
  }
  const verificationPolicy = approvalWorkflow.verificationPolicy ?? { requireVerification: false };
  const verificationSummary = verificationPolicy.requireVerification
    ? await getLatestVerificationStatus(branchRow.workspace_id ?? scope.workspaceId, tenantId, {
        revisionId: input.revisionId,
      }).catch(swallow("getLatestVerificationStatus", null))
    : null;
  const readiness = evaluatePublishReadiness({
    branchId: input.branchId,
    revisionId: input.revisionId,
    approvalRules: approvalRulesFromWorkflow(approvalWorkflow),
    approvals,
    verificationSummary: verificationSummary ?? undefined,
    verificationPolicy,
    approvalWorkflow,
  });

  if (readiness.status !== "READY") {
    return readiness.blockingReasons.map((b) => b.message).join(" ");
  }

  if (isFeatureEnabledForPlan("bulkProductionSimulation", getSpctrePlan())) {
    const regression = await getLatestManagedSimulationRegression({
      tenantId,
      workspaceId: branchRow.workspace_id ?? scope.workspaceId,
      revisionId: input.revisionId,
    });
    if (!regression) {
      // Only require a managed simulation when there is runtime evidence to
      // replay. A workspace with no evidence yet (e.g. first policy before any
      // agent traffic) has nothing to regress against, so the gate would be
      // unsatisfiable — don't dead-end publication.
      const evidenceCount = await countRuntimeEvidence(
        branchRow.workspace_id ?? scope.workspaceId,
        tenantId,
      );
      if (evidenceCount > 0) {
        return "Publish is blocked: run a managed retained-log simulation for this revision before publishing.";
      }
    } else if (regression.blockingCount > 0) {
      return `Publish is blocked: managed replay found ${regression.blockingCount} regression(s), including ${regression.newlyDeniedExpectedWorkCount} newly denied expected action(s), ${regression.removedEscalationCoverageCount} removed escalation control(s), and ${regression.newlyAllowedHighRiskCount} newly allowed high-risk action(s).`;
    }
  }

  if (getBooleanEnv("GATEWAY_ENABLED", false)) {
    const escalationSummary = await getOpenEscalationSummaryForRevision(input.revisionId, tenantId);
    if (escalationSummary.count > 0) {
      const slaHint = escalationSummary.nearestSlaDueAt
        ? ` Nearest SLA due: ${escalationSummary.nearestSlaDueAt}.`
        : "";
      return `Publish is blocked: ${escalationSummary.count} unresolved gateway escalation(s) remain for this revision.${slaHint}`;
    }
  }

  return null;
}

export async function publishRevisionDecision(
  input: PublishRevisionInput,
  scope: ActiveScope,
): Promise<PublishRevisionResult> {
  const started = Date.now();
  return await withSpan(
    "review.publish",
    { "spctre.branch_id": input.branchId, "spctre.revision_id": input.revisionId },
    async (span) => {
      if (!input.revisionId || !input.branchId) return { error: "Missing revision or branch." };

      const workspaceContext = scope;
      const tenantId = workspaceContext.tenantId;

      const authorized = await authorizePublish(input, scope);
      if ("error" in authorized) return authorized;
      const { branchRow, actor } = authorized;

      const readinessError = await checkPublishReadiness(input, scope, branchRow);
      if (readinessError) return { error: readinessError };

      const existingArtifactHash = await getExistingPublishArtifactHash({
        tenantId,
        branchId: input.branchId,
        revisionId: input.revisionId,
      });
      if (existingArtifactHash) {
        recordDuration("spctre.review.publish.duration", Date.now() - started, {
          outcome: "already_published",
        });
        return { artifactHash: existingArtifactHash };
      }

      const artifactHash = `sha256:${createHash("sha256")
        .update(`${input.revisionId}-${Date.now()}`)
        .digest("hex")
        .slice(0, 16)}`;

      try {
        await insertPolicyPublish({
          tenantId,
          branchId: input.branchId,
          revisionId: input.revisionId,
          artifactHash,
          actorId: actor.id,
        });
      } catch (error) {
        logger.error("[publishRevisionDecision] database error:", {
          error: error instanceof Error ? error.message : String(error),
        });
        return { error: "An unexpected error occurred. Please try again." };
      }

      appendOperationsLog({
        tenantId,
        workspaceId: workspaceContext.workspaceId,
        eventType: "POLICY_PUBLISH",
        sourceId: input.revisionId,
        sourceTable: "policy_publish",
        actorId: actor.id,
        payload: { branchId: input.branchId, revisionId: input.revisionId, artifactHash },
      }).catch(swallow("appendOperationsLog", undefined));

      span.setAttribute("spctre.artifact_hash", artifactHash);
      recordDuration("spctre.review.publish.duration", Date.now() - started, {
        outcome: "published",
      });
      return { artifactHash };
    },
  );
}
