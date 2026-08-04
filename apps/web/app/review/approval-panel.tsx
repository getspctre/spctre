"use client";

import { CheckCircle2, Clock3, Loader, Play, XCircle } from "lucide-react";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  ApprovalWorkflowSnapshot,
  PolicyApproval,
  PublishReadiness,
  SimulationRegressionSummary,
} from "@spctre/policy-schema";
import { runSimulation } from "@/app/evidence/actions";
import type { SimulationState } from "@/app/evidence/actions";
import { addApproval, publishRevision } from "./publish-actions";
import type { ApprovalState, PublishState } from "./publish-actions";

const statusIcon = { APPROVED: CheckCircle2, CHANGES_REQUESTED: XCircle, PENDING: Clock3 };

const statusClass: Record<string, string> = {
  APPROVED: "pill pillAllow",
  CHANGES_REQUESTED: "pill pillBlock",
  PENDING: "pill pillWarn",
};

interface ApprovalPanelProps {
  branchId: string;
  revisionId: string;
  allRoles: readonly string[];
  requiredRoles: string[];
  approvalRules?: Array<{ role: string; requiredCount: number }>;
  approvals: PolicyApproval[];
  isPublished: boolean;
  actorId: string;
  actorName: string;
  reviewableRoles: string[];
  reviewBlockedReason?: string;
}

export function getPolicyApprovalRoleSummary({
  approvals,
  role,
  actorId,
}: {
  approvals: PolicyApproval[];
  role: string;
  actorId: string;
}) {
  const roleApprovals = approvals.filter((approval) => approval.role === role);
  return {
    actorApproval: roleApprovals.find((approval) => approval.reviewer === actorId),
    approvedCount: roleApprovals.filter((approval) => approval.status === "APPROVED").length,
  };
}

interface PublishGateProps {
  branchId: string;
  revisionId: string;
  approvalWorkflow?: ApprovalWorkflowSnapshot;
  readiness: PublishReadiness;
  isPublished: boolean;
  actorId: string;
  canPublish: boolean;
  publishReason?: string;
  simulationRegression: SimulationRegressionSummary | null;
  requiresManagedSimulation: boolean;
}

function isSimulationSuccess(
  state: SimulationState,
): state is Exclude<SimulationState, { error: string } | null> {
  return !!state && !("error" in state);
}

function ManagedSimulationGate({ branchId, revisionId }: { branchId: string; revisionId: string }) {
  const [state, action, pending] = useActionState<SimulationState, FormData>(runSimulation, null);
  const router = useRouter();

  useEffect(() => {
    if (isSimulationSuccess(state)) router.refresh();
  }, [router, state]);

  return (
    <div className="blockerActionRow">
      <div>
        <p className="meta">
          A managed retained-log simulation is required before this revision can be published.
        </p>
        {isSimulationSuccess(state) ? (
          <p className="meta">Simulation logged. Refreshing publish readiness…</p>
        ) : null}
        {state?.error ? (
          <p className="meta publishError" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <form action={action}>
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="revisionId" value={revisionId} />
        <button className="button buttonSmall" type="submit" disabled={pending}>
          {pending ? <Loader size={14} className="spin" /> : <Play size={14} />}
          {pending ? "Running…" : "Run simulation"}
        </button>
      </form>
    </div>
  );
}

export function PublishGate({
  branchId,
  revisionId,
  approvalWorkflow,
  readiness,
  isPublished,
  actorId,
  canPublish,
  publishReason,
  simulationRegression,
  requiresManagedSimulation,
}: PublishGateProps) {
  const [publishState, publishAction, publishPending] = useActionState<PublishState, FormData>(
    publishRevision,
    null,
  );
  const simulationRequired = requiresManagedSimulation && !simulationRegression;

  return (
    <div className="publishGate" id="publish-gate">
      <p className="eyebrow">Workflow · Publish</p>
      {approvalWorkflow ? (
        <p className="meta">
          Workflow: {approvalWorkflow.name} ({approvalWorkflow.reviewMode.toLowerCase()} review)
        </p>
      ) : null}

      {simulationRequired ? (
        <ManagedSimulationGate branchId={branchId} revisionId={revisionId} />
      ) : null}

      {readiness.blockingReasons.length > 0 ? (
        <div className="blockerList">
          {readiness.blockingReasons.map((blocker) => (
            <div className="blockerActionRow" key={blocker.message}>
              <p className="meta">{blocker.message}</p>
              {blocker.href && blocker.cta ? (
                <a className="button buttonSmall" href={blocker.href}>
                  {blocker.cta}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {isPublished || publishState?.artifactHash ? (
        <div className="publishSuccess">
          <CheckCircle2 size={16} />
          <div>
            <p className="meta">Published</p>
            {publishState?.artifactHash ? <code>{publishState.artifactHash}</code> : null}
          </div>
        </div>
      ) : (
        <form action={publishAction}>
          <input type="hidden" name="revisionId" value={revisionId} />
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="actorId" value={actorId} />
          <button
            className="button buttonPrimary"
            type="submit"
            disabled={
              readiness.status !== "READY" || publishPending || !canPublish || simulationRequired
            }
            title={
              readiness.status === "READY" && canPublish && !simulationRequired
                ? "Publish approved policy bundle"
                : simulationRequired
                  ? "Run the required managed simulation first."
                  : (publishReason ?? readiness.blockingReasons[0]?.message)
            }
          >
            {publishPending ? "Publishing…" : "Publish bundle"}
          </button>
          {publishState?.error ? <p className="meta publishError">{publishState.error}</p> : null}
        </form>
      )}
    </div>
  );
}

function ApprovalRoleCard({
  role,
  revisionId,
  approvals,
  actorId,
  isRequired,
  requiredCount,
  isPublished,
  canReviewRole,
  reviewReason,
  approvalAction,
}: {
  role: string;
  revisionId: string;
  approvals: PolicyApproval[];
  actorId: string;
  isRequired: boolean;
  requiredCount: number | undefined;
  isPublished: boolean;
  canReviewRole: boolean;
  reviewReason: string | undefined;
  approvalAction: (formData: FormData) => void;
}) {
  const { actorApproval, approvedCount } = getPolicyApprovalRoleSummary({
    approvals,
    role,
    actorId,
  });
  const Icon = statusIcon[actorApproval?.status ?? "PENDING"];

  return (
    <article className="approvalCard">
      <div className="approvalCardHeader">
        <div>
          <h3>
            {role}
            {isRequired ? ` · ${approvedCount} of ${requiredCount ?? 1} approved` : ""}
          </h3>
          {isRequired ? <span className="approvalRequired">required</span> : null}
        </div>
        <span className={statusClass[actorApproval?.status ?? "PENDING"]}>
          <Icon size={13} />
          {actorApproval?.status ?? "PENDING"}
        </span>
      </div>

      {actorApproval?.reviewedAt ? (
        <p className="meta">Your decision: {actorApproval.reviewedAt.slice(0, 10)}</p>
      ) : null}

      {!isPublished && actorApproval?.status !== "APPROVED" ? (
        <div className="approvalActions">
          <form action={approvalAction}>
            <input type="hidden" name="revisionId" value={revisionId} />
            <input type="hidden" name="role" value={role} />
            <button
              className="button buttonSmall buttonAllow"
              name="approvalStatus"
              value="APPROVED"
              type="submit"
              disabled={!canReviewRole}
              title={reviewReason}
            >
              Approve
            </button>
            <label className="srOnly" htmlFor={`review-note-${role}`}>
              Reason for requested changes
            </label>
            <input
              className="input"
              id={`review-note-${role}`}
              name="note"
              placeholder="Reason for requested changes"
            />
            <button
              className="button buttonSmall"
              name="approvalStatus"
              value="CHANGES_REQUESTED"
              type="submit"
              disabled={!canReviewRole}
              title={reviewReason}
            >
              Request changes
            </button>
          </form>
        </div>
      ) : null}

      {!isPublished && actorApproval?.status === "APPROVED" ? (
        <div className="approvalActions">
          <form
            action={approvalAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `Withdraw your ${role} approval? Publish will be blocked until re-approved.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="revisionId" value={revisionId} />
            <input type="hidden" name="role" value={role} />
            <button
              className="button buttonSmall"
              name="approvalStatus"
              value="CHANGES_REQUESTED"
              type="submit"
              disabled={!canReviewRole}
              title={reviewReason}
            >
              Withdraw
            </button>
          </form>
        </div>
      ) : null}

      {!canReviewRole ? <p className="meta publishError">{reviewReason}</p> : null}
    </article>
  );
}

export function ApprovalPanel({
  branchId,
  revisionId,
  allRoles,
  requiredRoles,
  approvalRules,
  approvals,
  isPublished,
  actorId,
  actorName,
  reviewableRoles,
  reviewBlockedReason,
}: ApprovalPanelProps) {
  const [approvalState, approvalAction] = useActionState<ApprovalState, FormData>(
    addApproval,
    null,
  );

  return (
    <>
      {approvalState?.error ? <p className="meta publishError">{approvalState.error}</p> : null}
      <div className="approvalGrid" id="reviews">
        {allRoles
          .filter((role) => requiredRoles.includes(role))
          .map((role) => {
            const canReviewRole = reviewableRoles.includes(role);
            return (
              <ApprovalRoleCard
                key={role}
                role={role}
                revisionId={revisionId}
                approvals={approvals.filter((approval) => approval.role === role)}
                actorId={actorId}
                isRequired={requiredRoles.includes(role)}
                requiredCount={approvalRules?.find((r) => r.role === role)?.requiredCount}
                isPublished={isPublished}
                canReviewRole={canReviewRole}
                reviewReason={
                  canReviewRole
                    ? undefined
                    : (reviewBlockedReason ?? `${actorName} cannot review as ${role}.`)
                }
                approvalAction={approvalAction}
              />
            );
          })}
      </div>
      {allRoles.some((role) => !requiredRoles.includes(role)) ? (
        <details className="optionalReviewers">
          <summary>Additional reviewers</summary>
          <p className="meta">These approvals are recorded but do not unblock publication.</p>
          <div className="approvalGrid">
            {allRoles
              .filter((role) => !requiredRoles.includes(role))
              .map((role) => {
                const canReviewRole = reviewableRoles.includes(role);
                return (
                  <ApprovalRoleCard
                    key={role}
                    role={role}
                    revisionId={revisionId}
                    approvals={approvals.filter((approval) => approval.role === role)}
                    actorId={actorId}
                    isRequired={false}
                    requiredCount={undefined}
                    isPublished={isPublished}
                    canReviewRole={canReviewRole}
                    reviewReason={
                      canReviewRole
                        ? undefined
                        : (reviewBlockedReason ?? `${actorName} cannot review as ${role}.`)
                    }
                    approvalAction={approvalAction}
                  />
                );
              })}
          </div>
        </details>
      ) : null}
    </>
  );
}
