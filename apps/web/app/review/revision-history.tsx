"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader, RotateCcw } from "lucide-react";
import { rollbackBranch } from "./publish-actions";
import type { RollbackState } from "./publish-actions";
import type { BranchRevision } from "@/lib/domains/review/service";

import { SlideOutPanel } from "@/app/slide-out-panel";
import {
  formatArtifactHash,
  formatProvenanceId,
  isForensicViewMode,
  type AppViewMode,
} from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

interface RevisionHistoryProps {
  branchId: string;
  revisions: BranchRevision[];
  viewMode: AppViewMode;
}

function RevisionMetadataSection({
  rev,
  viewMode,
}: {
  rev: BranchRevision;
  viewMode: AppViewMode;
}) {
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Revision metadata</p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Revision ID</span>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>
            {formatProvenanceId(rev.revisionId, viewMode, 16, hashToFingerprint)}
          </code>
        </div>
        <div>
          <span className="meta">Author</span>
          <strong>
            {isForensicViewMode(viewMode) ? rev.authorId : (rev.authorEmail ?? rev.authorId)}
          </strong>
        </div>
        <div>
          <span className="meta">Source format</span>
          <strong>{rev.sourceFormat}</strong>
        </div>
        {rev.packVersion ? (
          <div>
            <span className="meta">Pack version</span>
            <strong>{rev.packVersion}</strong>
          </div>
        ) : null}
        {rev.packId ? (
          <div>
            <span className="meta">Pack ID</span>
            <strong>{rev.packId}</strong>
          </div>
        ) : null}
        <div>
          <span className="meta">Source hash</span>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>
            {formatArtifactHash(rev.sourceHash, viewMode, hashToFingerprint)}
          </code>
        </div>
        {rev.publishedAt ? (
          <div>
            <span className="meta">Published</span>
            <strong>{rev.publishedAt.slice(0, 10)}</strong>
          </div>
        ) : null}
        {rev.parentRevisionId ? (
          <div>
            <span className="meta">Parent revision</span>
            <code style={{ fontSize: 12 }}>
              {formatProvenanceId(rev.parentRevisionId, viewMode, 12, hashToFingerprint)}
            </code>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RevisionHistory({ branchId, revisions, viewMode }: RevisionHistoryProps) {
  const [state, action, isPending] = useActionState<RollbackState, FormData>(rollbackBranch, null);

  const rolledBackTo = state?.revisionId;
  const [confirmRevisionId, setConfirmRevisionId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const activeRevision = revisions.find((revision) => revision.isActive);

  return (
    <div className="revisionList">
      {state?.error ? (
        <div className="importError" style={{ marginBottom: 4 }}>
          {state.error}
        </div>
      ) : null}

      {rolledBackTo ? (
        <div className="revisionRollbackSuccess">
          <CheckCircle2 size={14} />
          <span>
            Rolled back to{" "}
            <code>{formatProvenanceId(rolledBackTo, viewMode, 12, hashToFingerprint)}</code> — new
            artifact{" "}
            <code>{formatArtifactHash(state.artifactHash, viewMode, hashToFingerprint)}</code>
          </span>
        </div>
      ) : null}

      {revisions.map((rev) => {
        const isRolledBackTarget = rolledBackTo === rev.revisionId;
        const canRollBack = !rev.isActive && rev.publishedAt !== null;

        return (
          <SlideOutPanel
            key={rev.revisionId}
            eyebrow={rev.isActive ? "Active revision" : rev.publishedAt ? "Published" : "Draft"}
            title={rev.message}
            description={`${formatProvenanceId(rev.revisionId, viewMode, 12, hashToFingerprint)} · ${isForensicViewMode(viewMode) ? rev.authorId : (rev.authorEmail ?? rev.authorId)} · ${rev.ruleCount} ${rev.ruleCount === 1 ? "rule" : "rules"}`}
            width="wide"
            trigger={({ open, triggerId }) => (
              <article className="revisionRow">
                <button
                  aria-label={`Inspect revision ${formatProvenanceId(rev.revisionId, viewMode, 12, hashToFingerprint)}`}
                  className="rowButton"
                  id={triggerId}
                  onClick={open}
                  type="button"
                >
                  <div className="revisionMeta">
                    <div>
                      <p className="meta">{rev.createdAt.slice(0, 10)}</p>
                      <h3>{rev.message}</h3>
                      <p className="meta">
                        <code>
                          {formatProvenanceId(rev.revisionId, viewMode, 12, hashToFingerprint)}
                        </code>
                        {" / "}
                        {isForensicViewMode(viewMode)
                          ? rev.authorId
                          : (rev.authorEmail ?? rev.authorId)}
                        {" / "}
                        {rev.ruleCount} {rev.ruleCount === 1 ? "rule" : "rules"}
                        {" / "}
                        {rev.sourceFormat}
                        {rev.packVersion ? ` / pack v${rev.packVersion}` : ""}
                      </p>
                    </div>
                    <div className="revisionBadges">
                      {rev.isActive ? <span className="pill pillAllow">Active</span> : null}
                      {rev.publishedAt ? (
                        <span className="pill pillNeutral">
                          Published {rev.publishedAt.slice(0, 10)}
                        </span>
                      ) : null}
                      {isRolledBackTarget ? (
                        <span className="pill pillAllow">
                          <CheckCircle2 size={11} />
                          Restored
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </article>
            )}
          >
            <div className="packDrawerSummary">
              <div>
                <span className="meta">Status</span>
                <strong>{rev.isActive ? "Active" : rev.publishedAt ? "Published" : "Draft"}</strong>
              </div>
              <div>
                <span className="meta">Rules</span>
                <strong>{rev.ruleCount}</strong>
              </div>
              <div>
                <span className="meta">Created</span>
                <strong>{rev.createdAt.slice(0, 10)}</strong>
              </div>
            </div>

            <RevisionMetadataSection rev={rev} viewMode={viewMode} />

            <div className="packRuleDetail">
              <p className="eyebrow">Commit message</p>
              <p>{rev.message}</p>
            </div>

            {canRollBack && !isRolledBackTarget ? (
              <div className="packDrawerFooter">
                {confirmRevisionId === rev.revisionId ? (
                  <form action={action} className="rollbackConfirmation">
                    <p>
                      <strong>Restore this published revision?</strong>
                    </p>
                    <p className="meta">
                      This republishes{" "}
                      <code>
                        {formatProvenanceId(rev.revisionId, viewMode, 12, hashToFingerprint)}
                      </code>{" "}
                      ({rev.ruleCount} rules) and replaces the active revision{" "}
                      <code>
                        {formatProvenanceId(
                          activeRevision?.revisionId,
                          viewMode,
                          12,
                          hashToFingerprint,
                        )}
                      </code>{" "}
                      when agents next sync.
                    </p>
                    <label className="rollbackAcknowledgement">
                      <input
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                        type="checkbox"
                      />
                      I understand this changes the production policy.
                    </label>
                    <input type="hidden" name="branchId" value={branchId} />
                    <input type="hidden" name="targetRevisionId" value={rev.revisionId} />
                    <div className="toolbar">
                      <button
                        className="button"
                        onClick={() => {
                          setConfirmRevisionId(null);
                          setAcknowledged(false);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="button buttonPrimary"
                        type="submit"
                        disabled={isPending || !acknowledged}
                      >
                        {isPending ? (
                          <Loader size={14} className="spin" />
                        ) : (
                          <RotateCcw size={14} />
                        )}
                        Restore and publish
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className="button"
                    onClick={() => {
                      setConfirmRevisionId(rev.revisionId);
                      setAcknowledged(false);
                    }}
                    type="button"
                  >
                    <RotateCcw size={14} />
                    Restore this revision
                  </button>
                )}
              </div>
            ) : null}
          </SlideOutPanel>
        );
      })}
    </div>
  );
}
