import { createHash } from "crypto";
import { logger } from "@spctre/platform/logging";
import {
  describeBlockingIssues,
  describePolicyRequestBudget,
  evaluatePublishReadiness,
  measurePolicyRequestBudget,
  validatePolicyRules,
} from "@spctre/policy-schema";
import { getBranchPermissions, type Principal } from "@/lib/actors";
import type { ReviewActorResolver } from "./actor";
import type { ActiveScope } from "@/lib/workspace";
import { getBooleanEnv } from "@/lib/platform/config";
import { recordDuration, setGauge } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import {
  getApprovals,
  getExistingPublishArtifactHash,
  getPublishBranchScope,
  getRulesForRevision,
  insertPolicyPublish,
  revisionExistsOnPublishBranch,
} from "@/lib/repositories/policy";
import { listPublishedCompositionLayers } from "@/lib/repositories/shared/composition";
import { runWithTenantContext } from "@/lib/tenant-context";
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
import { isFeatureEntitled } from "@/lib/entitlements/features";
import { swallow } from "@/lib/platform/swallow";

export interface PublishRevisionInput {
  revisionId: string;
  branchId: string;
}

export type PublishRevisionResult = { artifactHash: string } | { error: string };

type PublishBranchRow = NonNullable<Awaited<ReturnType<typeof getPublishBranchScope>>>;
type PublishActor = Principal;

// Validate the branch/revision exist and the actor may publish. Returns the
// resolved context, or an error result to surface directly.
async function authorizePublish(
  input: PublishRevisionInput,
  scope: ActiveScope,
  resolveActor: ReviewActorResolver,
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

  const { principalId, actor } = await resolveActor({
    workspaceId: branchRow.workspace_id ?? scope.workspaceId,
    tenantId,
  });
  if (!actor) {
    await insertAuthorizationDenialEvent({
      tenantId,
      action: "publish.execute",
      reason: "No permission grant for the acting principal.",
      resourceType: "policy_branch",
      resourceId: input.branchId,
      principalId,
      workspaceId: branchRow.workspace_id,
    });
    return { error: "No permission grants are configured for the acting principal." };
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

/**
 * Refuses a publish whose composed policy would not fit the kernel's bounded
 * request.
 *
 * Enforcement sends the whole composed layer set on every decision, so a policy
 * over the limit does not degrade — every gateway decision for the workspace
 * fails closed with no prior signal. The ceiling is reached by publishing, so
 * this is the point at which it is actionable: the author can still split or
 * trim the policy. Utilization is recorded on the span either way, so headroom
 * is observable well before it runs out.
 */
async function checkEvaluationBudget(
  input: PublishRevisionInput,
  scope: ActiveScope,
  branchRow: PublishBranchRow,
  rules: Awaited<ReturnType<typeof getRulesForRevision>>,
): Promise<string | null> {
  const workspaceId = branchRow.workspace_id ?? scope.workspaceId;
  // The caller has already bound the tenant; this read is not self-binding, so
  // it would otherwise be the one RLS rejects.
  const published = await listPublishedCompositionLayers(workspaceId, scope.tenantId);
  // What enforcement would load after this publish: every other branch's
  // current layer, with this branch's contributed by the revision under review.
  const prospective = [
    ...published
      .filter((layer) => layer.branchId !== input.branchId)
      .map((layer) => ({ scope: layer.scope, rules: layer.rules })),
    { scope: branchRow.scope, rules },
  ];

  const budget = measurePolicyRequestBudget(prospective);
  // A gauge, not a duration: this is the headroom signal to watch in staging.
  setGauge("spctre.policy.evaluation_budget.utilization", budget.utilization, {
    workspace_id: workspaceId ?? "organization",
    outcome: budget.fits ? "fits" : "exceeded",
  });
  if (budget.fits) return null;
  return (
    `Publish is blocked: ${describePolicyRequestBudget(budget)}. ` +
    "Every gateway decision sends the composed policy to the evaluator, so " +
    "publishing this would fail closed for the whole workspace. Split the " +
    "policy across narrower scopes or remove rules before publishing."
  );
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
  // Enforceability first: a bundle the kernel cannot evaluate must not reach
  // production, where a broken rule reads as a permitted action.
  const validation = validatePolicyRules(rules);
  if (!validation.valid) {
    return `Publish is blocked: ${describeBlockingIssues(validation)}`;
  }
  const budgetError = await checkEvaluationBudget(input, scope, branchRow, rules);
  if (budgetError) return budgetError;
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

  if (await isFeatureEntitled("bulkProductionSimulation", tenantId)) {
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

export interface PublishReadiness {
  status: "READY" | "BLOCKED";
  blockingReasons: string[];
  requiredRoles: string[];
  approvals: Awaited<ReturnType<typeof getApprovals>>;
  verificationRequired: boolean;
}

/**
 * What publishing this revision would answer right now, without publishing it.
 *
 * Deliberately runs `checkPublishReadiness` — the same function the publish
 * path runs — so READY here and a refusal there cannot disagree. A CI job polls
 * this to know whether the reviewers are done; it is a read and takes no
 * write scope.
 */
export async function getPublishReadiness(
  input: PublishRevisionInput,
  scope: ActiveScope,
): Promise<PublishReadiness | { error: string }> {
  const tenantId = scope.tenantId;
  // Bound here for the same reason as the publish path: a bearer caller has no
  // tenant on the connection until its token is authenticated.
  return runWithTenantContext(tenantId, async () => {
    const branchRow = await getPublishBranchScope({ tenantId, branchId: input.branchId });
    if (!branchRow) return { error: "Branch not found." };

    const hasRevision = await revisionExistsOnPublishBranch({
      tenantId,
      branchId: input.branchId,
      revisionId: input.revisionId,
      workspaceId: branchRow.workspace_id,
    });
    if (!hasRevision) return { error: "Revision not found on this branch." };

    const [approvals, approvalWorkflow, blocking] = await Promise.all([
      getApprovals(input.revisionId, tenantId),
      getApprovalWorkflowForContext({
        tenantId,
        workspaceId: branchRow.workspace_id ?? scope.workspaceId,
        environment: branchRow.environment,
      }),
      checkPublishReadiness(input, scope, branchRow),
    ]);

    return {
      status: blocking ? "BLOCKED" : "READY",
      blockingReasons: blocking ? [blocking] : [],
      requiredRoles: approvalRulesFromWorkflow(approvalWorkflow).map((rule) => rule.role),
      approvals,
      verificationRequired: approvalWorkflow.verificationPolicy?.requireVerification ?? false,
    };
  });
}

export async function publishRevisionDecision(
  input: PublishRevisionInput,
  scope: ActiveScope,
  resolveActor: ReviewActorResolver,
): Promise<PublishRevisionResult> {
  const started = Date.now();
  return await withSpan(
    "review.publish",
    { "spctre.branch_id": input.branchId, "spctre.revision_id": input.revisionId },
    async (span) => {
      if (!input.revisionId || !input.branchId) return { error: "Missing revision or branch." };

      const workspaceContext = scope;
      const tenantId = workspaceContext.tenantId;

      // Bound once for the whole publish: a bearer caller arrives with no
      // tenant on the connection, and everything below reads or writes
      // tenant-scoped rows. Re-binding the same tenant on the session path,
      // where the session guard already bound it, changes nothing.
      return runWithTenantContext(tenantId, async () => {
        const authorized = await authorizePublish(input, scope, resolveActor);
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
      });
    },
  );
}
