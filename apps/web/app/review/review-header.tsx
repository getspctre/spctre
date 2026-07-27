import { Activity } from "lucide-react";
import { PageHeader } from "@spctre/ui";
import type { PolicyBranch, PublishReadiness } from "@spctre/policy-schema";
import type { AppViewMode } from "@/lib/app-view-mode";
import { formatProvenanceId } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { describeBranchScope } from "@/lib/policy-targets";
import { BranchSelector } from "./branch-selector";

interface ReviewHeaderProps {
  eyebrow: string;
  isPublished: boolean;
  readiness: PublishReadiness;
  readinessPillClass: string;
  activeBranch: PolicyBranch | undefined;
  branches: PolicyBranch[];
  workspaceSlug: string | undefined;
  nextStep: { eyebrow: string; label: string; description: string; href: string; action: string } | null;
  viewMode: AppViewMode;
}

export function ReviewHeader({
  eyebrow,
  isPublished,
  readiness,
  readinessPillClass,
  activeBranch,
  branches,
  workspaceSlug,
  nextStep,
  viewMode,
}: ReviewHeaderProps) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title="Review & publish"
        actions={
          <>
            {activeBranch?.activeRevision ? (
              <a
                className="button"
                href={`/${workspaceSlug}/simulate?sim_branch=${activeBranch.id}&sim_revision=${activeBranch.activeRevision}`}
              >
                <Activity size={16} />
                Simulate changes
              </a>
            ) : null}
          </>
        }
      />

      <section className="reviewHero" aria-label="Review context">
        <div className="reviewHeroMain">
          <div className="reviewHeroHeader">
            <div>
              <p className="eyebrow">Branch · Workspace policy</p>
              <h2>{activeBranch?.name ?? "Select a policy branch"}</h2>
            </div>
            <span className={readinessPillClass} title={readiness.blockingReasons.map((b) => b.message).join(" · ") || undefined}>
              {isPublished
                ? "PUBLISHED"
                : readiness.status === "READY"
                  ? "Ready to publish"
                  : readiness.blockingReasons.length > 0
                    ? "Action required"
                    : "PENDING"}
            </span>
          </div>
          <BranchSelector
            branches={branches}
            selectedId={activeBranch?.id}
            workspaceSlug={workspaceSlug ?? ""}
          />
          {activeBranch ? (
            <div className="reviewProvenance">
              <span>
                Revision <code>{formatProvenanceId(activeBranch.activeRevision, viewMode, 12, hashToFingerprint)}</code>
              </span>
              <span>{describeBranchScope(activeBranch)}</span>
              <span>{activeBranch.author}</span>
            </div>
          ) : null}
          {nextStep ? (
            <div className="reviewNextStep">
              <div>
                <p className="eyebrow">{nextStep.eyebrow}</p>
                <strong>{nextStep.label}</strong>
                <p className="meta">{nextStep.description}</p>
              </div>
              <a className="button buttonSmall" href={nextStep.href}>{nextStep.action}</a>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
