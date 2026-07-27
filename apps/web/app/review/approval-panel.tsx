"use client";

import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { useActionState } from "react";
import type { ApprovalWorkflowSnapshot, PolicyApproval, PublishReadiness } from "@spctre/policy-schema";
import { addApproval, publishRevision } from "./publish-actions";
import type { ApprovalState, PublishState } from "./publish-actions";

const statusIcon = {
  APPROVED: CheckCircle2,
  CHANGES_REQUESTED: XCircle,
  PENDING: Clock3
};

const statusClass: Record<string, string> = {
  APPROVED: "pill pillAllow",
  CHANGES_REQUESTED: "pill pillBlock",
  PENDING: "pill pillWarn"
};


interface ApprovalPanelProps {
  branchId: string;
  revisionId: string;
  allRoles: readonly string[];
  requiredRoles: string[];
  approvalRules?: Array<{ role: string; requiredCount: number }>;
  approvals: PolicyApproval[];
  isPublished: boolean;
  actorName: string;
  reviewableRoles: string[];
  reviewBlockedReason?: string;
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
}

export function PublishGate({
  branchId,
  revisionId,
  approvalWorkflow,
  readiness,
  isPublished,
  actorId,
  canPublish,
  publishReason
}: PublishGateProps) {
  const [publishState, publishAction, publishPending] = useActionState<PublishState, FormData>(
    publishRevision,
    null
  );

  return (
    <div className="publishGate" id="publish-gate">
      <p className="eyebrow">Workflow · Publish</p>
      {approvalWorkflow ? (
        <p className="meta">
          Workflow: {approvalWorkflow.name} ({approvalWorkflow.reviewMode.toLowerCase()} review)
        </p>
      ) : null}

      {readiness.blockingReasons.length > 0 ? (
        <div className="blockerList">
          {readiness.blockingReasons.map((blocker) => (
            <div className="blockerActionRow" key={blocker.message}>
              <p className="meta">{blocker.message}</p>
              {blocker.href && blocker.cta ? (
                <a className="button buttonSmall" href={blocker.href}>{blocker.cta}</a>
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
            {publishState?.artifactHash ? (
              <code>{publishState.artifactHash}</code>
            ) : null}
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
            disabled={readiness.status !== "READY" || publishPending || !canPublish}
            title={
              readiness.status === "READY" && canPublish
                ? "Publish approved policy bundle"
                : publishReason ?? readiness.blockingReasons[0]?.message
            }
          >
            {publishPending ? "Publishing…" : "Publish bundle"}
          </button>
          {publishState?.error ? (
            <p className="meta publishError">{publishState.error}</p>
          ) : null}
        </form>
      )}
    </div>
  );
}

function ApprovalRoleCard({
  role,
  revisionId,
  existing,
  isRequired,
  requiredCount,
  isPublished,
  canReviewRole,
  reviewReason,
  approvalAction,
}: {
  role: string;
  revisionId: string;
  existing: PolicyApproval | undefined;
  isRequired: boolean;
  requiredCount: number | undefined;
  isPublished: boolean;
  canReviewRole: boolean;
  reviewReason: string | undefined;
  approvalAction: (formData: FormData) => void;
}) {
  const Icon = statusIcon[existing?.status ?? "PENDING"];

  return (
    <article className="approvalCard">
      <div className="approvalCardHeader">
        <div>
          <h3>{role}{requiredCount != null && requiredCount > 1 ? ` · 1 of ${requiredCount} required` : ""}</h3>
          {isRequired ? <span className="approvalRequired">required</span> : null}
        </div>
        <span className={statusClass[existing?.status ?? "PENDING"]}>
          <Icon size={13} />
          {existing?.status ?? "PENDING"}
        </span>
      </div>

      {existing?.reviewedAt ? (
        <p className="meta">{existing.reviewedAt.slice(0, 10)}</p>
      ) : null}

      {!isPublished && existing?.status !== "APPROVED" ? (
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
            <label className="srOnly" htmlFor={`review-note-${role}`}>Reason for requested changes</label>
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

      {!isPublished && existing?.status === "APPROVED" ? (
        <div className="approvalActions">
          <form
            action={approvalAction}
            onSubmit={(e) => {
              if (!window.confirm(`Withdraw your ${role} approval? Publish will be blocked until re-approved.`)) {
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
  actorName,
  reviewableRoles,
  reviewBlockedReason,
}: ApprovalPanelProps) {
  const [approvalState, approvalAction] = useActionState<ApprovalState, FormData>(addApproval, null);

  return (
    <>
      {approvalState?.error ? (
        <p className="meta publishError">{approvalState.error}</p>
      ) : null}
      <div className="approvalGrid" id="reviews">
        {allRoles.filter((role) => requiredRoles.includes(role)).map((role) => {
          const canReviewRole = reviewableRoles.includes(role);
          return (
            <ApprovalRoleCard
              key={role}
              role={role}
              revisionId={revisionId}
              existing={approvals.find((a) => a.role === role)}
              isRequired={requiredRoles.includes(role)}
              requiredCount={approvalRules?.find((r) => r.role === role)?.requiredCount}
              isPublished={isPublished}
              canReviewRole={canReviewRole}
              reviewReason={
                canReviewRole
                  ? undefined
                  : reviewBlockedReason ?? `${actorName} cannot review as ${role}.`
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
            {allRoles.filter((role) => !requiredRoles.includes(role)).map((role) => {
              const canReviewRole = reviewableRoles.includes(role);
              return (
                <ApprovalRoleCard
                  key={role}
                  role={role}
                  revisionId={revisionId}
                  existing={approvals.find((a) => a.role === role)}
                  isRequired={false}
                  requiredCount={undefined}
                  isPublished={isPublished}
                  canReviewRole={canReviewRole}
                  reviewReason={canReviewRole ? undefined : reviewBlockedReason ?? `${actorName} cannot review as ${role}.`}
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
