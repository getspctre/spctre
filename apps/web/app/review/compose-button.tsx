"use client";

import { useActionState } from "react";
import { Combine, Loader } from "lucide-react";
import { refreshReviewComposition } from "./compose-actions";
import type { ComposeState } from "./compose-actions";

interface ComposeReviewButtonProps {
  branchId: string;
  revisionId: string;
  workspaceSlug: string;
}

export function ComposeReviewButton({
  branchId,
  revisionId,
  workspaceSlug,
}: ComposeReviewButtonProps) {
  const [state, action, isPending] = useActionState<ComposeState, FormData>(
    refreshReviewComposition,
    null
  );

  const isDisabled = isPending || !branchId || !revisionId;
  const title = branchId && revisionId
    ? "Recompute the effective policy composition for this revision"
    : "Select a branch to compose.";

  return (
    <form action={action}>
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <button className="button" type="submit" disabled={isDisabled} title={title}>
        {isPending ? <Loader size={16} className="spin" /> : <Combine size={16} />}
        {isPending ? "Preparing review bundle..." : "Prepare review bundle"}
      </button>
      {state?.error ? <p className="meta publishError">{state.error}</p> : null}
    </form>
  );
}
