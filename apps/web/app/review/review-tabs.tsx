import { Clock3, Lock } from "lucide-react";
import { TabsRow } from "@spctre/ui";

type ReviewStage = "review" | "impact" | "publish" | "history";

interface ReviewTabsProps {
  reviewContent: React.ReactNode;
  impactContent: React.ReactNode;
  publishContent: React.ReactNode;
  historyContent: React.ReactNode;
  hasArtifact?: boolean;
  hasHistory?: boolean;
  activeStage: ReviewStage;
  reviewHref: string;
  impactHref: string;
  publishHref: string;
  historyHref: string;
}

export function ReviewTabs({
  reviewContent,
  impactContent,
  publishContent,
  historyContent,
  hasArtifact,
  hasHistory,
  activeStage,
  reviewHref,
  impactHref,
  publishHref,
  historyHref,
}: ReviewTabsProps) {
  const publishLocked = !hasArtifact && !publishContent;
  const historyLocked = !hasHistory;

  return (
    <>
      <div className="reviewTabsNav">
        <nav aria-label="Review workflow stages">
        <TabsRow>
          <a
            className={activeStage === "review" ? "uiTab uiTabActive" : "uiTab"}
            href={reviewHref}
          >
            Review changes
          </a>
          <a
            className={activeStage === "impact" ? "uiTab uiTabActive" : "uiTab"}
            href={impactHref}
          >
            Impact summary
          </a>
          <a
            className={activeStage === "publish" ? "uiTab uiTabActive" : "uiTab"}
            href={publishHref}
          >
            {publishLocked ? <Lock size={12} style={{ marginRight: 4, opacity: 0.6 }} /> : null}
            Approvals & readiness
          </a>
          <a
            className={activeStage === "history" ? "uiTab uiTabActive" : "uiTab"}
            href={historyHref}
          >
            {historyLocked ? <Clock3 size={12} style={{ marginRight: 4, opacity: 0.6 }} /> : null}
            History
          </a>
        </TabsRow>
        </nav>
        {publishLocked ? (
          <p className="meta reviewStageHint"><Lock size={13} aria-hidden="true" /> Compose the revision in Review changes to unlock approvals and publish readiness.</p>
        ) : null}
      </div>
      {activeStage === "review" && (reviewContent ?? (
        <section className="panel reviewPanel">
          <div className="emptyState">
            <p className="meta">No diff available for this branch yet.</p>
          </div>
        </section>
      ))}
      {activeStage === "impact" && (impactContent ?? (
        <section className="panel reviewPanel">
          <div className="emptyState">
            <h3>No impact summary yet</h3>
            <p className="meta">Compose a policy revision to see its review impact.</p>
          </div>
        </section>
      ))}
      {activeStage === "publish" && (publishContent ?? (
        <section className="panel reviewPanel">
          <div className="emptyState">
            <h3>Compose the revision first</h3>
            <p className="meta">
              Approvals and publish readiness become available after composing the policy bundle. Go to{" "}
              <a
                className="button buttonSmall"
                href={reviewHref}
                style={{ display: "inline" }}
              >
                Review changes
              </a>{" "}
              tab and click Compose.
            </p>
          </div>
        </section>
      ))}
      {activeStage === "history" && (historyContent ?? (
        <section className="panel reviewPanel">
          <div className="emptyState">
            <h3>No revision history yet</h3>
            <p className="meta">History appears after a real branch records revisions.</p>
          </div>
        </section>
      ))}
    </>
  );
}
