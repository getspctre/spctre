"use client";

import { useActionState } from "react";
import { claimEscalation, type ClaimEscalationState } from "./actions";

export function ClaimButton({ queueId }: { queueId: string }) {
  const [state, action, pending] = useActionState<ClaimEscalationState, FormData>(
    claimEscalation,
    null
  );

  if (state && "ok" in state) {
    return <span className="pill pillWarn">In review</span>;
  }

  return (
    <form action={action}>
      <input type="hidden" name="queueId" value={queueId} />
      {state && "error" in state && (
        <p className="meta" role="alert" style={{ color: "var(--block)", marginBottom: 4 }}>{state.error}</p>
      )}
      <button
        type="submit"
        className="button"
        disabled={pending}
        style={{ fontSize: 12, padding: "4px 10px" }}
      >
        {pending ? "Claiming…" : "Claim"}
      </button>
    </form>
  );
}
