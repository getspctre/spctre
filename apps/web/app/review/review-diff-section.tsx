import type { PolicyRevisionDiff } from "@spctre/policy-schema";
import type { AppViewMode } from "@/lib/app-view-mode";
import { formatProvenanceId } from "@/lib/app-view-mode";
import { DiffRuleInspector } from "./diff-rule-inspector";
import { hashToFingerprint } from "@/lib/fingerprint";

interface ReviewDiffSectionProps {
  diff: PolicyRevisionDiff;
  viewMode: AppViewMode;
}

export function ReviewDiffSection({
  diff,
  viewMode,
}: ReviewDiffSectionProps) {
  return (
    <>
      <section className="panel reviewPanel" id="diff">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Diff · Rules</p>
            <h2>
              <code>{formatProvenanceId(diff.baseRevisionId, viewMode, 12, hashToFingerprint)}</code> to{" "}
              <code>{formatProvenanceId(diff.compareRevisionId, viewMode, 12, hashToFingerprint)}</code>
            </h2>
          </div>
        </div>

        <div className="diffSummary" aria-label="Revision diff summary">
          <div>
            <span className="meta">Added</span>
            <strong>{diff.summary.added}</strong>
          </div>
          <div>
            <span className="meta">Modified</span>
            <strong>{diff.summary.modified}</strong>
          </div>
          <div>
            <span className="meta">Removed</span>
            <strong>{diff.summary.removed}</strong>
          </div>
          <div>
            <span className="meta">Unchanged</span>
            <strong>{diff.summary.unchanged}</strong>
          </div>
        </div>

        <div className="diffList">
          {diff.rules.map((rule) => (
            <DiffRuleInspector
              key={rule.stableRuleId}
              diff={rule}
            />
          ))}
        </div>
      </section>
    </>
  );
}
