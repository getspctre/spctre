"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PolicyBranch } from "@spctre/policy-schema";
import { describeBranchScope } from "@/lib/policy-targets";
import { deleteBranchAdmin } from "./branch-actions";
import { formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { useTranslations } from "next-intl";

function statusPillClass(status: PolicyBranch["status"]): string {
  if (status === "PUBLISHED") return "pill pillAllow";
  if (status === "IN_REVIEW") return "pill pillWarn";
  return "pill";
}

interface BranchTableProps {
  branches: PolicyBranch[];
  isAdmin: boolean;
  viewMode: AppViewMode;
  workspaceSlug?: string;
}

export function BranchTable({ branches, isAdmin, viewMode, workspaceSlug }: BranchTableProps) {
  const [selected, setSelected] = useState<PolicyBranch | null>(null);

  return (
    <>
      <div className="auditTableWrapper">
        <table className="auditTable">
          <thead>
            <tr>
              <th>Status</th>
              <th>Branch / Message</th>
              <th>Scope / Author</th>
              <th>Revision</th>
              <th><span className="srOnly">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr
                key={branch.id}
                id={`branch-${branch.id}`}
                className="auditRow"
              >
                <td>
                  <span className={statusPillClass(branch.status)}>{branch.status}</span>
                </td>
                <td>
                  <strong>{branch.name}</strong>
                  <span className="meta tableSubtext">
                    {branch.message}
                  </span>
                </td>
                <td>
                  <span className="meta">
                    {describeBranchScope(branch)} / {branch.author}
                  </span>
                </td>
                <td>
                  <code>{formatProvenanceId(branch.activeRevision, viewMode, 12, hashToFingerprint)}</code>
                  {branch.parentRevision ? (
                    <span className="meta tableSubtext">
                      from <code>{formatProvenanceId(branch.parentRevision, viewMode, 12, hashToFingerprint)}</code>
                    </span>
                  ) : null}
                </td>
                <td>
                  <button className="button buttonSmall" type="button" onClick={() => setSelected(branch)}>
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <BranchInspectorPanel
          branch={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          viewMode={viewMode}
          workspaceSlug={workspaceSlug}
        />
      ) : null}
    </>
  );
}

interface PanelProps {
  branch: PolicyBranch;
  isAdmin: boolean;
  onClose: () => void;
  viewMode: AppViewMode;
  workspaceSlug?: string;
}

function BranchDangerZone({
  branch,
  confirmText,
  setConfirmText,
  deleteAction,
  deleteState,
  deletePending,
}: {
  branch: PanelProps["branch"];
  confirmText: string;
  setConfirmText: (value: string) => void;
  deleteAction: (formData: FormData) => void;
  deleteState: Awaited<ReturnType<typeof deleteBranchAdmin>> | null;
  deletePending: boolean;
}) {
  const canDelete = confirmText === branch.name;
  const isPublished = branch.status === "PUBLISHED";

  return (
    <div className="branchDangerZone">
      <p className="eyebrow dangerEyebrow">Danger zone</p>
      {isPublished ? (
        <p className="meta">
          This branch is currently published and cannot be deleted. Any branch with a
          published revision is permanently protected from deletion.
        </p>
      ) : (
        <>
          <p className="meta">
            Permanently deletes this branch and all its revisions. Runtime evidence
            referencing this branch is retained but the policy history is gone.
          </p>
          <form action={deleteAction} className="branchDeleteForm">
            <input type="hidden" name="branchId" value={branch.id} />
            <label>
              <span className="metadata">Type the branch name to confirm: <strong>{branch.name}</strong></span>
              <input
                autoComplete="off"
                className="input"
                name="confirm"
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={branch.name}
                value={confirmText}
              />
            </label>
            {deleteState && "error" in deleteState ? (
              <p className="meta workspaceError">
                {deleteState.error}
              </p>
            ) : null}
            <button
              className="button buttonPillDanger"
              disabled={!canDelete || deletePending}
              type="submit"
            >
              {deletePending ? "Deleting…" : "Delete branch permanently"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function BranchInspectorPanel({ branch, isAdmin, onClose, viewMode, workspaceSlug }: PanelProps) {
  const t = useTranslations("author");
  const [confirmText, setConfirmText] = useState("");
  const [deleteState, deleteAction, deletePending] = useActionState(deleteBranchAdmin, null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (deleteState && "success" in deleteState) {
      onClose();
    }
  }, [deleteState, onClose]);

  return (
    <div className="slideOutLayer" role="presentation">
      <button
        aria-label="Close panel"
        className="slideOutOverlay"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="branch-panel-title"
        aria-modal="true"
        className="slideOutPanel"
        data-width="wide"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="slideOutHeader">
          <div>
            <p className="eyebrow">Policy branch</p>
            <h2 id="branch-panel-title">{branch.name}</h2>
            <p className="meta">{branch.message}</p>
          </div>
          <button
            aria-label="Close panel"
            className="iconButton"
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="slideOutBody">
          {workspaceSlug ? (
            <div className="branchInspectorActions" style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              {branch.status !== "PUBLISHED" ? (
                <a
                  className="button buttonPrimary"
                  href={`/${workspaceSlug}/author?branch=${branch.id}`}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {t("edit_rules")}
                </a>
              ) : null}
              <a
                className={`button${branch.status === "PUBLISHED" ? " buttonPrimary" : ""}`}
                href={`/${workspaceSlug}/review?branch=${branch.id}`}
                style={{ flex: branch.status === "PUBLISHED" ? 1 : 0.8, justifyContent: "center" }}
              >
                Review & Publish
              </a>
            </div>
          ) : null}

          <div className="packDrawerSummary">
            <div>
              <span className="meta">Status</span>
              <span className={statusPillClass(branch.status)}>{branch.status}</span>
            </div>
            <div>
              <span className="meta">Scope</span>
              <strong>{branch.scope}</strong>
            </div>
            <div>
              <span className="meta">Author</span>
              <strong>{branch.author}</strong>
            </div>
            {branch.environment ? (
              <div>
                <span className="meta">Environment</span>
                <strong>{branch.environment}</strong>
              </div>
            ) : null}
            {branch.connector ? (
              <div>
                <span className="meta">Connector</span>
                <strong>{branch.connector}</strong>
              </div>
            ) : null}
          </div>

          <div className="packRuleDetail">
            <p className="eyebrow">Revision</p>
            <div className="packRuleMeta">
              <div>
                <span className="meta">Active revision</span>
                <code className="breakCode">
                  {formatProvenanceId(branch.activeRevision, viewMode, 16, hashToFingerprint)}
                </code>
              </div>
              {branch.parentRevision ? (
                <div>
                  <span className="meta">Parent revision</span>
                  <code className="breakCode">
                    {formatProvenanceId(branch.parentRevision, viewMode, 16, hashToFingerprint)}
                  </code>
                </div>
              ) : null}
              <div>
                <span className="meta">Branch ID</span>
                <code className="breakCode">
                  {formatProvenanceId(branch.id, viewMode, 16, hashToFingerprint)}
                </code>
              </div>
            </div>
          </div>

          {isAdmin ? (
            <BranchDangerZone
              branch={branch}
              confirmText={confirmText}
              setConfirmText={setConfirmText}
              deleteAction={deleteAction}
              deleteState={deleteState}
              deletePending={deletePending}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
