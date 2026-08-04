"use client";

import { History } from "lucide-react";
import type { PolicyTimelineEvent } from "@spctre/policy-schema";
import { SlideOutPanel } from "@/app/slide-out-panel";
import { formatArtifactHash, formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

interface Props {
  event: PolicyTimelineEvent;
  viewMode: AppViewMode;
}

export function TimelineEventInspector({ event, viewMode }: Props) {
  return (
    <SlideOutPanel
      eyebrow={`${event.kind} · ${event.createdAt?.slice(0, 10)}`}
      title={event.title}
      description={event.detail}
      trigger={({ open, triggerId }) => (
        <article className="timelineEvent">
          <div className="timelineIcon">
            <History size={16} />
          </div>
          <div className="timelineEventContent">
            <button
              aria-label={`Inspect timeline event: ${event.title}`}
              className="rowButton"
              id={triggerId}
              onClick={open}
              type="button"
            >
              <div className="rowHeader">
                <div>
                  <p className="meta">
                    {event.kind} / {event.createdAt?.slice(0, 16)?.replace("T", " ")}
                    {event.actor ? ` / ${event.actor}` : ""}
                  </p>
                  <h3>{event.title}</h3>
                </div>
                {event.status ? <span className="pill">{event.status}</span> : null}
              </div>
              <p className="meta">{event.detail}</p>
            </button>
          </div>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Kind</span>
          <strong>{event.kind}</strong>
        </div>
        <div>
          <span className="meta">Status</span>
          <strong>{event.status || "—"}</strong>
        </div>
        <div>
          <span className="meta">Actor</span>
          <strong>{event.actor || "system"}</strong>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Event metadata</p>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Event ID</span>
            <code className="breakCode">
              {formatProvenanceId(event.id, viewMode, 16, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Branch</span>
            <code className="smallCode">
              {formatProvenanceId(event.branchId, viewMode, 16, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Revision</span>
            <code className="smallCode">
              {formatProvenanceId(event.revisionId, viewMode, 16, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Timestamp</span>
            <strong>{event.createdAt?.slice(0, 16)?.replace("T", " ")}</strong>
          </div>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Detail</p>
        <p>{event.detail}</p>
      </div>

      {event.artifactHash || event.sourceId ? (
        <div className="packRuleDetail">
          <p className="eyebrow">Artifact provenance</p>
          <div className="packRuleMeta">
            {event.artifactHash ? (
              <div>
                <span className="meta">Artifact hash</span>
                <code className="breakCode">
                  {formatArtifactHash(event.artifactHash, viewMode, hashToFingerprint)}
                </code>
              </div>
            ) : null}
            {event.sourceId ? (
              <div>
                <span className="meta">Source ID</span>
                <code className="breakCode">
                  {formatProvenanceId(event.sourceId, viewMode, 16, hashToFingerprint)}
                </code>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </SlideOutPanel>
  );
}
