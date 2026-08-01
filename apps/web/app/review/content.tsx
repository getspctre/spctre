import { getReviewPageModel } from "@/app/review/review-page-model";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { ReviewHeader } from "./review-header";
import { ReviewComposeSection } from "./review-compose-section";
import { ReviewDiffSection } from "./review-diff-section";
import {
  ReviewHistorySection,
  ReviewPublishSection,
} from "./review-approvals-section";
import { ReviewTabs } from "./review-tabs";
import { ReviewImpactSummary } from "./review-impact-summary";
import { getTranslations } from "next-intl/server";

type ReviewStage = "review" | "impact" | "publish" | "history";
type PublishTab = "coverage" | "verification" | "export";
type ReviewSearchParams = {
  branch?: string | string[];
  stage?: string | string[];
  reviewTab?: string | string[];
  publishTab?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getReviewStage(params: ReviewSearchParams): ReviewStage {
  const stage = firstParam(params.stage);
  if (stage === "impact" || stage === "publish" || stage === "history") return stage;

  const legacyReviewTab = firstParam(params.reviewTab);
  if (legacyReviewTab === "approve") return "publish";

  return "review";
}

function getPublishTab(params: ReviewSearchParams): PublishTab {
  const tab = firstParam(params.publishTab);
  return tab === "verification" || tab === "export" ? tab : "coverage";
}

function buildReviewHref(
  path: string,
  params: ReviewSearchParams,
  next: { stage?: ReviewStage; publishTab?: PublishTab }
): string {
  const urlParams = new URLSearchParams();
  const branch = firstParam(params.branch);
  if (branch) urlParams.set("branch", branch);
  if (next.stage && next.stage !== "review") urlParams.set("stage", next.stage);
  if (next.publishTab && next.publishTab !== "coverage") urlParams.set("publishTab", next.publishTab);
  const query = urlParams.toString();
  const hash = next.publishTab
    ? "publish"
    : next.stage === "publish"
      ? "publish-action"
      : next.stage === "history"
        ? "history"
        : next.stage === "impact"
          ? "impact-summary"
        : "diff";
  return `${path}${query ? `?${query}` : ""}#${hash}`;
}

type ReviewModel = Awaited<ReturnType<typeof getReviewPageModel>>;

function reviewNextStep(model: ReviewModel, reviewPath: string) {
  const branch = model.activeBranch;
  const branchQuery = branch ? `?branch=${branch.id}` : "";
  if (!branch) return null;
  if (model.isPublished) {
    return { eyebrow: "Revision status", label: "This revision is published", description: "Use History to inspect or restore a prior published revision.", href: `${reviewPath}${branchQuery}&stage=history#history`, action: "View history" };
  }
  const blocker = model.readiness.blockingReasons[0];
  if (blocker?.href && blocker.cta) {
    const publishTab = blocker.href === "#verification" ? "&publishTab=verification" : "";
    return { eyebrow: "Next required step", label: blocker.cta, description: blocker.message, href: `${reviewPath}${branchQuery}&stage=publish${publishTab}${blocker.href}`, action: blocker.cta };
  }
  if (model.readiness.status === "READY") {
    return { eyebrow: "Next required step", label: "Publish this revision", description: "Required approvals and verification checks are complete.", href: `${reviewPath}${branchQuery}&stage=publish#publish-action`, action: "Publish revision" };
  }
  return { eyebrow: "Next required step", label: "Resolve publication requirements", description: blocker?.message ?? "Review outstanding approvals and verification requirements.", href: `${reviewPath}${branchQuery}&stage=publish#reviews`, action: "Open requirements" };
}

function ImpactTabContent({ model }: { model: ReviewModel }) {
  if (!model.activeDiff) return null;
  return (
    <ReviewImpactSummary
      diff={model.activeDiff}
      blastRadius={model.blastRadius}
      approvalRules={model.approvalRules}
      approvals={model.approvals}
      readiness={model.readiness}
      simulationRegression={model.simulationRegression}
      artifactHash={model.activeArtifact?.artifactHash ?? null}
      viewMode={model.appViewMode}
      workspaceSlug={model.workspaceContext.workspaceSlug}
      branchId={model.activeBranch?.id ?? null}
      revisionId={model.activeBranch?.activeRevision ?? null}
    />
  );
}

function ReviewStageContent({ model }: { model: ReviewModel }) {
  return (
    <>
      {model.activeComposition && model.activeDiff ? (
        <ReviewDiffSection
          diff={model.activeDiff}
          viewMode={model.appViewMode}
        />
      ) : null}
      {model.activeComposition && model.activeDiff ? (
        <ReviewComposeSection
          composition={model.activeComposition}
          branchId={model.activeBranch?.id ?? ""}
          revisionId={model.activeBranch?.activeRevision ?? ""}
          workspaceSlug={model.workspaceContext.workspaceSlug}
          viewMode={model.appViewMode}
        />
      ) : null}
    </>
  );
}

export async function ReviewPageContent({
  workspaceSlug,
  searchParams
}: {
  workspaceSlug?: string;
  searchParams: Promise<ReviewSearchParams>;
}) {
  const params = await searchParams;
  const selectedBranchId = firstParam(params.branch);
  const model = await getReviewPageModel({ workspaceSlug, selectedBranchId });
  const t = await getTranslations("review");
  const reviewPath = `/${model.workspaceContext.workspaceSlug}/review`;
  const activeReviewStage = getReviewStage(params);
  const activePublishTab = getPublishTab(params);
  const nextStep = reviewNextStep(model, reviewPath);

  return (
    <>
      <ReviewHeader
        eyebrow={formatWorkspaceEyebrow(model.workspaceContext)}
        isPublished={model.isPublished}
        readiness={model.readiness}
        readinessPillClass={model.readinessPillClass}
        activeBranch={model.activeBranch}
        requestedBranchUnavailable={model.requestedBranchUnavailable}
        branches={model.branches}
        workspaceSlug={model.workspaceContext.workspaceSlug}
        nextStep={nextStep}
        viewMode={model.appViewMode}
      />
      {(model.activeComposition && model.activeDiff) || (model.activeArtifact && model.activeBundle) ? (
        <ReviewTabs
          hasArtifact={!!(model.activeArtifact && model.activeBundle)}
          hasHistory={model.usingRealBranch && !!model.activeBranch && model.revisions.length > 0}
          activeStage={activeReviewStage}
          reviewHref={buildReviewHref(reviewPath, params, { stage: "review" })}
          impactHref={buildReviewHref(reviewPath, params, { stage: "impact" })}
          publishHref={buildReviewHref(reviewPath, params, { stage: "publish" })}
          historyHref={buildReviewHref(reviewPath, params, { stage: "history" })}
          reviewContent={<ReviewStageContent model={model} />}
          impactContent={<ImpactTabContent model={model} />}
          publishContent={model.activeArtifact && model.activeBundle ? (
            <ReviewPublishSection
              activeBranch={model.activeBranch}
              usingRealBranch={model.usingRealBranch}
              approvalRules={model.approvalRules}
              approvals={model.approvals}
              compatibilityReport={model.compatibilityReport}
              approvalWorkflow={model.approvalWorkflow}
              readiness={model.readiness}
              isPublished={model.isPublished}
              actor={model.actor}
              permissions={model.permissions}
              verificationSummary={model.verificationSummary}
              activeArtifact={model.activeArtifact}
              activeBundle={model.activeBundle}
              viewMode={model.appViewMode}
              activePublishTab={activePublishTab}
              publishCoverageHref={buildReviewHref(reviewPath, params, {
                stage: "publish",
                publishTab: "coverage",
              })}
              publishVerificationHref={buildReviewHref(reviewPath, params, {
                stage: "publish",
                publishTab: "verification",
              })}
              publishExportHref={buildReviewHref(reviewPath, params, {
                stage: "publish",
                publishTab: "export",
              })}
            />
          ) : null}
          historyContent={model.usingRealBranch && !!model.activeBranch && model.revisions.length > 0 ? (
            <ReviewHistorySection
              activeBranch={model.activeBranch}
              usingRealBranch={model.usingRealBranch}
              revisions={model.revisions}
              viewMode={model.appViewMode}
            />
          ) : null}
        />
      ) : (
        <section className="panel">
          <div className="emptyState">
            <h3>{t("empty.title")}</h3>
            <p className="meta">{t("empty.description")}</p>
          </div>
        </section>
      )}
    </>
  );
}
