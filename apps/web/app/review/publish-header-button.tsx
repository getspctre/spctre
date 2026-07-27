"use client";

import { useActionState } from "react";
import { UploadCloud } from "lucide-react";
import { publishRevision } from "./publish-actions";
import type { PublishState } from "./publish-actions";

interface PublishHeaderButtonProps {
  branchId: string;
  revisionId: string;
  readinessStatus: string;
  isPublished: boolean;
  canPublish: boolean;
  publishReason?: string;
}

export function PublishHeaderButton({
  branchId,
  revisionId,
  readinessStatus,
  isPublished,
  canPublish,
  publishReason,
}: PublishHeaderButtonProps) {
  const [publishState, publishAction, publishPending] = useActionState<PublishState, FormData>(
    publishRevision,
    null
  );

  const isReady = readinessStatus === "READY";

  if (isPublished || publishState?.artifactHash) {
    return (
      <button className="button buttonPrimary disabled" disabled>
        <UploadCloud size={16} />
        Published
      </button>
    );
  }

  const disabled = !isReady || publishPending || !canPublish;
  const title = isReady && canPublish
    ? "Publish approved policy bundle to production"
    : publishReason ?? "Approvals are required before publishing.";

  return (
    <form
      action={publishAction}
      onSubmit={(e) => {
        if (!window.confirm("Are you sure you want to publish this approved policy bundle to production?")) {
          e.preventDefault();
        }
      }}
      style={{ display: "inline-block" }}
    >
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="branchId" value={branchId} />
      <button
        className={`button buttonPrimary${disabled ? " disabled" : ""}`}
        type="submit"
        disabled={disabled}
        title={title}
      >
        <UploadCloud size={16} />
        {publishPending ? "Publishing…" : "Publish bundle"}
      </button>
      {publishState?.error ? (
        <span className="meta publishError" style={{ marginLeft: 8, color: "var(--color-fd-muted-foreground, red)" }}>
          {publishState.error}
        </span>
      ) : null}
    </form>
  );
}
