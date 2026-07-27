import { RotateCcw } from "lucide-react";
import type {
  PolicyBranch,
  PolicyApproval,
  PolicyApprovalRule,
  PolicyArtifactExport,
  AgtCompatiblePolicyBundle,
  AgtVerificationSummary,
  ApprovalWorkflowSnapshot,
  PublishReadiness,
} from "@spctre/policy-schema";
import type { BundleCompatibilityReport } from "@spctre/policy-schema";
import type { AppViewMode } from "@/lib/app-view-mode";
import { ALL_REVIEWER_ROLES } from "@/lib/approval-config";
import type { BranchRevision } from "@/lib/domains/review/service";
import type { Principal } from "@/lib/actors";
import type { BranchPermissionSnapshot } from "@/lib/actors";
import { ApprovalPanel, PublishGate } from "./approval-panel";
import { RevisionHistory } from "./revision-history";
import {
  MockApprovalSummary,
} from "./review-approval-subsections";
import { PublishSubsectionTabs } from "./publish-subsection-tabs";

interface ReviewApprovalsSectionProps {
  activeBranch: PolicyBranch | undefined;
  usingRealBranch: boolean;
  approvalRules: PolicyApprovalRule[];
  approvals: PolicyApproval[];
  readiness: PublishReadiness;
  isPublished: boolean;
  actor: Principal;
  permissions: BranchPermissionSnapshot;
  viewMode: AppViewMode;
}

interface ReviewPublishSectionProps {
  activeBranch: PolicyBranch | undefined;
  usingRealBranch: boolean;
  approvalRules: PolicyApprovalRule[];
  approvals: PolicyApproval[];
  compatibilityReport: BundleCompatibilityReport | null;
  approvalWorkflow: ApprovalWorkflowSnapshot | null;
  readiness: PublishReadiness;
  isPublished: boolean;
  actor: Principal;
  permissions: BranchPermissionSnapshot;
  verificationSummary: AgtVerificationSummary | null;
  activeArtifact: PolicyArtifactExport;
  activeBundle: AgtCompatiblePolicyBundle;
  viewMode: AppViewMode;
  activePublishTab: "coverage" | "verification" | "export";
  publishCoverageHref: string;
  publishVerificationHref: string;
  publishExportHref: string;
}

interface ReviewHistorySectionProps {
  activeBranch: PolicyBranch | undefined;
  usingRealBranch: boolean;
  revisions: BranchRevision[];
  viewMode: AppViewMode;
}

export function ReviewApprovalsSection({
  activeBranch,
  usingRealBranch,
  approvalRules,
  approvals,
  readiness,
  isPublished,
  actor,
  permissions,
  viewMode,
}: ReviewApprovalsSectionProps) {
  return (
    <>
      {activeBranch ? (
        <section className="panel reviewPanel" id="reviews">
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Workflow · Approve</p>
              <h2>Approvals</h2>
              <p className="meta">
                {usingRealBranch
                  ? `${approvalRules.filter((rule) => approvals.some((a) => a.role === rule.role && a.status === "APPROVED")).length} of ${approvalRules.length} required approvals · ${(() => {
                      const pendingRoles = approvalRules
                        .filter((rule) => !approvals.some((a) => a.role === rule.role && a.status === "APPROVED"))
                        .map((rule) => rule.role);
                      if (pendingRoles.length === 0) return "all required approvals complete.";
                      if (pendingRoles.length === 1) return `1 pending ${pendingRoles[0]} review.`;
                      return `${pendingRoles.length} pending reviews (${pendingRoles.join(", ")}).`;
                    })()}`
                  : "Showing mock approval data — import a policy to start a real review"}
              </p>
            </div>
          </div>

          {usingRealBranch ? (
            <ApprovalPanel
              branchId={activeBranch.id}
              revisionId={activeBranch.activeRevision}
              allRoles={ALL_REVIEWER_ROLES}
              requiredRoles={approvalRules.map((r) => r.role)}
              approvalRules={approvalRules}
              approvals={approvals}
              isPublished={isPublished}
              actorName={actor.name}
              reviewableRoles={permissions.reviewableRoles}
              reviewBlockedReason={permissions.reviewBlockedReason}
            />
          ) : (
            <MockApprovalSummary readiness={readiness} />
          )}
        </section>
      ) : null}
    </>
  );
}

export function ReviewPublishSection({
  activeBranch,
  usingRealBranch,
  approvalRules,
  approvals,
  compatibilityReport,
  approvalWorkflow,
  readiness,
  isPublished,
  actor,
  permissions,
  verificationSummary,
  activeArtifact,
  activeBundle,
  viewMode,
  activePublishTab,
  publishCoverageHref,
  publishVerificationHref,
  publishExportHref,
}: ReviewPublishSectionProps) {
  return (
    <>
      <ReviewApprovalsSection
        activeBranch={activeBranch}
        usingRealBranch={usingRealBranch}
        approvalRules={approvalRules}
        approvals={approvals}
        readiness={readiness}
        isPublished={isPublished}
        actor={actor}
        permissions={permissions}
        viewMode={viewMode}
      />
      {activeBranch ? (
        <section className="panel reviewPanel" id="publish-action">
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Workflow · Publish</p>
              <h2>Publish readiness</h2>
              <p className="meta">
                Publish is available only after required approvals and verification gates pass.
              </p>
            </div>
          </div>
          <PublishGate
            branchId={activeBranch.id}
            revisionId={activeBranch.activeRevision}
            approvalWorkflow={approvalWorkflow ?? undefined}
            readiness={readiness}
            isPublished={isPublished}
            actorId={actor.id}
            canPublish={permissions.canPublish}
            publishReason={permissions.publishReason}
          />
        </section>
      ) : null}

      <PublishSubsectionTabs
        compatibilityReport={compatibilityReport}
        verificationSummary={verificationSummary}
        activeArtifact={activeArtifact}
        activeBundle={activeBundle}
        viewMode={viewMode}
        activeTab={activePublishTab}
        coverageHref={publishCoverageHref}
        verificationHref={publishVerificationHref}
        exportHref={publishExportHref}
      />
    </>
  );
}

export function ReviewHistorySection({
  activeBranch,
  usingRealBranch,
  revisions,
  viewMode,
}: ReviewHistorySectionProps) {
  return (
    <>
      {usingRealBranch && activeBranch && revisions.length > 0 ? (
        <section className="panel reviewPanel" id="history">
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Audit · History</p>
              <h2>
                Revisions
                <span className="headCount">{revisions.length}</span>
              </h2>
              <p className="meta">
                Rolling back republishes immediately. Agents pick up on next sync.
              </p>
            </div>
            <RotateCcw size={20} className="sectionIcon" />
          </div>
          <RevisionHistory branchId={activeBranch.id} revisions={revisions} viewMode={viewMode} />
        </section>
      ) : null}
    </>
  );
}
