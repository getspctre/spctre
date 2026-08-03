"use client";

import { CheckCircle2, Clock3, PlayCircle, RotateCcw, Send, ShieldCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AgentBlueprintStatus, PolicyApproval } from "@spctre/policy-schema";

const statusIcon = { APPROVED: CheckCircle2, CHANGES_REQUESTED: XCircle, PENDING: Clock3 } as const;
const statusClass: Record<string, string> = {
  APPROVED: "pill pillAllow",
  CHANGES_REQUESTED: "pill pillBlock",
  PENDING: "pill pillWarn",
};

async function postJson(url: string, body: unknown): Promise<{ error?: string }> {
  const response = await fetch(url, {
    method: url.includes("/revisions/") || url.endsWith("/simulate") || url.endsWith("/rollback") ? "POST" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) return { error: result?.error || "Request failed." };
  return {};
}

/**
 * DRAFT → IN_REVIEW → PUBLISHED transitions for the active revision. Both hit the
 * existing `PATCH /api/agent-blueprints/[id]` route, which enforces the source
 * lifecycle state and (for publish) approval readiness server-side.
 */
export function BlueprintLifecycleActions({
  blueprintId,
  revisionId,
  status,
  canPublish,
  publishBlockedReason,
}: {
  blueprintId: string;
  revisionId: string;
  status: AgentBlueprintStatus;
  canPublish: boolean;
  publishBlockedReason?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "IN_REVIEW" | "PUBLISHED">(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(next: "IN_REVIEW" | "PUBLISHED") {
    setError(null);
    setPending(next);
    const result = await postJson(`/api/agent-blueprints/${blueprintId}`, { revisionId, status: next });
    setPending(null);
    if (result.error) { setError(result.error); return; }
    router.refresh();
  }

  if (status === "PUBLISHED") {
    return (
      <span className="pill pillAllow blueprintLifecyclePublished">
        <ShieldCheck size={14} />
        Published revision
      </span>
    );
  }

  return (
    <div className="blueprintLifecycleActions">
      {status === "DRAFT" ? (
        <button className="button buttonPrimary" type="button" disabled={pending !== null} onClick={() => transition("IN_REVIEW")}>
          <Send size={15} />
          {pending === "IN_REVIEW" ? "Submitting…" : "Submit for review"}
        </button>
      ) : (
        <button
          className="button buttonPrimary"
          type="button"
          disabled={pending !== null || !canPublish}
          title={canPublish ? "Publish this Blueprint revision" : publishBlockedReason}
          onClick={() => transition("PUBLISHED")}
        >
          <ShieldCheck size={15} />
          {pending === "PUBLISHED" ? "Publishing…" : "Publish revision"}
        </button>
      )}
      {error ? <p className="meta publishError" role="alert">{error}</p> : null}
    </div>
  );
}

function ApprovalRoleCard({
  blueprintId,
  revisionId,
  role,
  requiredCount,
  isRequired,
  existing,
  canReview,
  reviewReason,
  disabled,
}: {
  blueprintId: string;
  revisionId: string;
  role: string;
  requiredCount?: number;
  isRequired: boolean;
  existing?: PolicyApproval;
  canReview: boolean;
  reviewReason?: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const Icon = statusIcon[existing?.status ?? "PENDING"];

  async function submit(nextStatus: "APPROVED" | "CHANGES_REQUESTED") {
    if (nextStatus === "CHANGES_REQUESTED" && existing?.status === "APPROVED"
      && !window.confirm(`Withdraw your ${role} approval? Publish will be blocked until re-approved.`)) return;
    setError(null);
    setPending(true);
    const result = await postJson(
      `/api/agent-blueprints/${blueprintId}/revisions/${revisionId}/approvals`,
      { role, status: nextStatus, note: note.trim() || null }
    );
    setPending(false);
    if (result.error) { setError(result.error); return; }
    setNote("");
    router.refresh();
  }

  const actionable = canReview && !disabled && !pending;

  return (
    <article className="approvalCard">
      <div className="approvalCardHeader">
        <div>
          <h3>{role}{requiredCount != null && requiredCount > 1 ? ` · 1 of ${requiredCount} required` : ""}</h3>
          {isRequired ? <span className="approvalRequired">required</span> : null}
        </div>
        <span className={statusClass[existing?.status ?? "PENDING"]}>
          <Icon size={13} />
          {existing?.status ?? "PENDING"}
        </span>
      </div>

      {existing?.reviewedAt ? <p className="meta">{existing.reviewedAt.slice(0, 10)}</p> : null}

      {!disabled ? (
        existing?.status === "APPROVED" ? (
          <div className="approvalActions">
            <button className="button buttonSmall" type="button" disabled={!actionable} title={reviewReason} onClick={() => submit("CHANGES_REQUESTED")}>
              {pending ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
        ) : (
          <div className="approvalActions">
            <button className="button buttonSmall buttonAllow" type="button" disabled={!actionable} title={reviewReason} onClick={() => submit("APPROVED")}>
              {pending ? "Recording…" : "Approve"}
            </button>
            <label className="srOnly" htmlFor={`bp-review-note-${role}`}>Reason for requested changes</label>
            <input
              className="input"
              id={`bp-review-note-${role}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reason for requested changes"
              disabled={!actionable}
            />
            <button className="button buttonSmall" type="button" disabled={!actionable} title={reviewReason} onClick={() => submit("CHANGES_REQUESTED")}>
              Request changes
            </button>
          </div>
        )
      ) : null}

      {!canReview && !disabled ? <p className="meta publishError">{reviewReason}</p> : null}
      {error ? <p className="meta publishError" role="alert">{error}</p> : null}
    </article>
  );
}

export type BlueprintApprovalRole = {
  role: string;
  isRequired: boolean;
  requiredCount?: number;
  existing?: PolicyApproval;
};

/**
 * Reviewer decisions for the revision under review. Each card POSTs to the
 * existing approvals route, which performs the real reviewer-role authorization;
 * `reviewableRoles` only drives the optimistic enable/disable of the controls.
 */
export function BlueprintApprovalGrid({
  blueprintId,
  revisionId,
  roles,
  reviewableRoles,
  reviewBlockedReason,
  actorName,
  isPublished,
}: {
  blueprintId: string;
  revisionId: string;
  roles: BlueprintApprovalRole[];
  reviewableRoles: string[];
  reviewBlockedReason?: string;
  actorName: string;
  isPublished: boolean;
}) {
  const required = roles.filter((role) => role.isRequired);
  const optional = roles.filter((role) => !role.isRequired);

  const card = (role: BlueprintApprovalRole) => {
    const canReview = reviewableRoles.includes(role.role);
    return (
      <ApprovalRoleCard
        key={role.role}
        blueprintId={blueprintId}
        revisionId={revisionId}
        role={role.role}
        requiredCount={role.requiredCount}
        isRequired={role.isRequired}
        existing={role.existing}
        canReview={canReview}
        reviewReason={canReview ? undefined : reviewBlockedReason ?? `${actorName} cannot review as ${role.role}.`}
        disabled={isPublished}
      />
    );
  };

  return (
    <>
      <div className="approvalGrid" id="reviews">{required.map(card)}</div>
      {optional.length ? (
        <details className="optionalReviewers">
          <summary>Additional reviewers</summary>
          <p className="meta">These approvals are recorded but do not unblock publication.</p>
          <div className="approvalGrid">{optional.map(card)}</div>
        </details>
      ) : null}
    </>
  );
}

type Simulation = {
  sourceEventCount: number;
  newlyBlockedCount: number;
  examples: Array<{ decisionId: string; connector: string; action: string }>;
};

/**
 * Dry-runs the selected revision's operating envelope against the agent's recent
 * runtime evidence, surfacing how many observed actions this definition would
 * newly block. Read-only; the route persists only an operations-log entry.
 */
export function BlueprintSimulatePanel({ blueprintId, revisionId }: { blueprintId: string; revisionId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);

  async function run() {
    setError(null);
    setPending(true);
    const response = await fetch(`/api/agent-blueprints/${blueprintId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    });
    const result = (await response.json().catch(() => null)) as { simulation?: Simulation; error?: string } | null;
    setPending(false);
    if (!response.ok || !result?.simulation) { setError(result?.error || "Simulation failed."); return; }
    setSimulation(result.simulation);
  }

  return (
    <div className="blueprintSimulate">
      <div className="blueprintSimulateHeader">
        <button className="button buttonSmall" type="button" disabled={pending} onClick={run}>
          <PlayCircle size={15} />
          {pending ? "Simulating…" : simulation ? "Re-run simulation" : "Simulate impact"}
        </button>
        {simulation ? (
          <p className="meta">
            {simulation.newlyBlockedCount} of {simulation.sourceEventCount} recent action{simulation.sourceEventCount === 1 ? "" : "s"} would be newly blocked.
          </p>
        ) : (
          <p className="meta">Replays this revision against the agent’s recent runtime evidence.</p>
        )}
      </div>
      {error ? <p className="meta publishError" role="alert">{error}</p> : null}
      {simulation && simulation.examples.length ? (
        <div className="auditTableWrapper">
          <table className="auditTable">
            <thead><tr><th>Decision</th><th>Connector</th><th>Action</th></tr></thead>
            <tbody>
              {simulation.examples.map((example) => (
                <tr className="auditRow" key={example.decisionId}>
                  <td><code className="smallCode">{example.decisionId.slice(0, 12)}</code></td>
                  <td>{example.connector}</td>
                  <td>{example.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {simulation && simulation.examples.length === 0 ? (
        <p className="meta">No recent action would be newly blocked by this envelope.</p>
      ) : null}
    </div>
  );
}

/**
 * Restores a previously published revision as the active runtime revision.
 * The route requires workspace-admin permission; disable when the actor lacks it.
 */
export function BlueprintRollbackButton({
  blueprintId,
  targetRevisionId,
  canRollback,
  blockedReason,
}: {
  blueprintId: string;
  targetRevisionId: string;
  canRollback: boolean;
  blockedReason?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rollback() {
    if (!window.confirm("Restore this published revision as the active Blueprint?")) return;
    setError(null);
    setPending(true);
    const result = await postJson(`/api/agent-blueprints/${blueprintId}/rollback`, { targetRevisionId });
    setPending(false);
    if (result.error) { setError(result.error); return; }
    router.refresh();
  }

  return (
    <>
      <button
        className="button buttonSmall"
        type="button"
        disabled={pending || !canRollback}
        title={canRollback ? "Restore this published revision" : blockedReason}
        onClick={rollback}
      >
        <RotateCcw size={13} />
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? <p className="meta publishError" role="alert">{error}</p> : null}
    </>
  );
}
