"use client";

import React, { useActionState, useState } from "react";
import { resolveEscalation, type ResolveEscalationState } from "./actions";

const OUTCOMES = [
  { value: "PROCEED", label: "Proceed", description: "Allow the action — mark risk as accepted." },
  {
    value: "ESCALATE",
    label: "Re-escalate",
    description: "Return to queue for additional review.",
  },
  { value: "ABORT", label: "Abort", description: "Reject the action — policy enforcement stands." },
] as const;

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--text)",
  fontSize: 13,
  padding: "6px 8px",
} as const;

export function ResolveForm({ queueId, onResolved }: { queueId: string; onResolved?: () => void }) {
  const [outcome, setOutcome] = useState<string>("");
  const [state, action, pending] = useActionState<ResolveEscalationState, FormData>(
    resolveEscalation,
    null,
  );

  React.useEffect(() => {
    if (state && "ok" in state) {
      onResolved?.();
    }
  }, [state, onResolved]);

  if (state && "ok" in state) {
    return (
      <p className="meta" style={{ color: "var(--allow)" }}>
        Resolved successfully.
      </p>
    );
  }

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="queueId" value={queueId} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="metadata" htmlFor={`outcome-${queueId}`}>
          Resolution outcome
        </label>
        <select
          id={`outcome-${queueId}`}
          name="resolutionOutcome"
          required
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          style={inputStyle}
        >
          <option value="">— select —</option>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {outcome ? (
          <p className="meta" style={{ marginTop: 4, color: "var(--fg)" }}>
            {OUTCOMES.find((o) => o.value === outcome)?.description}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="metadata" htmlFor={`note-${queueId}`}>
          Resolution note (optional)
        </label>
        <textarea
          id={`note-${queueId}`}
          name="resolutionNote"
          rows={2}
          placeholder="Add context for the audit trail…"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>
      {outcome === "ABORT" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="metadata" htmlFor={`guidance-${queueId}`}>
            Agent guidance (optional)
          </label>
          <p className="meta" style={{ marginBottom: 2 }}>
            This string is returned to the agent in the ABORT response so it can explain the
            rejection to the end user.
          </p>
          <textarea
            id={`guidance-${queueId}`}
            name="agentGuidance"
            rows={2}
            placeholder="e.g. This action requires VP approval. Contact finance-approvals@example.com."
            style={{ ...inputStyle, resize: "vertical", borderColor: "var(--warn)" }}
          />
        </div>
      ) : null}
      {state && "error" in state && (
        <p className="meta" style={{ color: "var(--block)" }}>
          {state.error}
        </p>
      )}
      <button
        type="submit"
        className="button buttonPrimary"
        disabled={pending}
        style={{ alignSelf: "flex-start" }}
      >
        {pending ? "Resolving…" : "Resolve"}
      </button>
    </form>
  );
}
