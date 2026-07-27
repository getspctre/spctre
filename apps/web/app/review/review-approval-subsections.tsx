import type { PublishReadiness } from "@spctre/policy-schema";
import { approvalIcons, approvalPillClass } from "@/lib/constants";

export function MockApprovalSummary({ readiness }: { readiness: PublishReadiness }) {
  return (
    <>
      <div className="approvalGrid">
        {readiness.approvals.map((approval) => {
          const ApprovalIcon = approvalIcons[approval.status];
          return (
            <article className="approvalCard" key={`${approval.role}-${approval.reviewer}`}>
              <div className="approvalCardHeader">
                <h3>{approval.reviewer}</h3>
                <span className={approvalPillClass[approval.status]}>
                  <ApprovalIcon size={13} />
                  {approval.status}
                </span>
              </div>
              <p className="meta">{approval.role}</p>
            </article>
          );
        })}
      </div>
      <div className="publishGate">
        {readiness.blockingReasons.map((blocker) => (
          <p className="meta" key={blocker.message}>{blocker.message}</p>
        ))}
      </div>
    </>
  );
}
