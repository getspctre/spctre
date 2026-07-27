"use client";

import type { SimulationReplayInput } from "@spctre/policy-schema";
import { SlideOutPanel } from "@/app/slide-out-panel";
import { simulationPillClass } from "@/lib/constants";
import { buildWorkspacePath } from "@/lib/workspace/path";

interface Props {
  result: SimulationReplayInput;
  branchId: string;
  revisionId: string;
  workspaceSlug?: string;
}

export function SimulationResultInspector({ result, branchId, revisionId, workspaceSlug }: Props) {
  const deltaClass = simulationPillClass[result.delta] ?? "pill";

  return (
    <SlideOutPanel
      eyebrow={`${result.connector}.${result.action}`}
      title={result.eventId}
      description={result.reason}
      trigger={({ open, triggerId }) => (
        <article className="simulationResult">
          <button
            aria-label={`Inspect simulation result ${result.eventId}`}
            className="rowButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <div className="rowHeader">
              <div>
                <h3>
                  {result.connector}.{result.action}
                </h3>
                <p className="meta">
                  <code>{result.eventId}</code> / {result.previousStatus} →{" "}
                  {result.proposedStatus}
                </p>
              </div>
              <span className={deltaClass}>{result.delta}</span>
            </div>
            <p className="meta">{result.reason}</p>
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Delta</span>
          <span className={deltaClass}>{result.delta}</span>
        </div>
        <div>
          <span className="meta">Previous</span>
          <strong>{result.previousStatus}</strong>
        </div>
        <div>
          <span className="meta">Proposed</span>
          <strong>{result.proposedStatus}</strong>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Event context</p>
        <a
          className="button buttonSmall"
          href={buildWorkspacePath(workspaceSlug ?? "", `/review?branch=${encodeURIComponent(branchId)}#diff`)}
        >
          Review this policy
        </a>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Event ID</span>
            <code style={{ fontSize: 12, wordBreak: "break-all" }}>{result.eventId}</code>
          </div>
          <div>
            <span className="meta">Branch</span>
            <a
              href={buildWorkspacePath(workspaceSlug ?? "", `/review?branch=${encodeURIComponent(branchId)}`)}
              style={{ fontSize: 12 }}
              title="Review this policy"
            >
              <code style={{ fontSize: 12 }}>{branchId}</code>
            </a>
          </div>
          <div>
            <span className="meta">Revision</span>
            <a
              href={buildWorkspacePath(workspaceSlug ?? "", `/review?branch=${encodeURIComponent(branchId)}#diff`)}
              style={{ fontSize: 12 }}
              title="Review this revision"
            >
              <code style={{ fontSize: 12 }}>{revisionId}</code>
            </a>
          </div>
          <div>
            <span className="meta">Action</span>
            <strong>
              {result.connector}.{result.action}
            </strong>
          </div>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Reason</p>
        <p>{result.reason}</p>
      </div>

      <div className="packDrawerRules">
        <p className="eyebrow">
          Matched policy refs
          <span className="headCount" style={{ marginLeft: 6 }}>
            {result.matchedPolicyRefs.length}
          </span>
        </p>
        {result.matchedPolicyRefs.length ? (
          <div className="packDrawerTags">
            {result.matchedPolicyRefs.map((ref) => (
              <span className="ruleRef" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        ) : (
          <p className="meta">No policy refs matched this event.</p>
        )}
      </div>
    </SlideOutPanel>
  );
}
