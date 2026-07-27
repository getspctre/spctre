"use client";

import { useActionState, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { SlideOutPanel } from "@/app/slide-out-panel";
import { deleteWorkspaceAdmin, updateWorkspaceAdmin } from "./workspace-actions";

interface WorkspaceCardProps {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  isActive: boolean;
}

export function WorkspaceCard({ id, slug, name, createdAt, isActive }: WorkspaceCardProps) {
  const t = useTranslations("admin.workspace.card");
  const [currentName, setCurrentName] = useState(name);
  const [currentSlug, setCurrentSlug] = useState(slug);
  const [confirmText, setConfirmText] = useState("");
  const closeRef = useRef<(() => void) | null>(null);

  const [updateState, updateAction, updatePending] = useActionState(updateWorkspaceAdmin, null);

  const isDirty = currentName !== name || currentSlug !== slug;
  const canDelete = confirmText === "DELETE";

  return (
    <article className="row">
      <div className="rowHeader">
        <div>
          <h3>{name}</h3>
          <p className="meta">{t("created", { createdAt })}</p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {isActive ? <span className="pill pillWarn">{t("active")}</span> : null}
        </div>
      </div>

      <form action={updateAction} style={{ display: "grid", gap: "10px" }}>
        <input type="hidden" name="workspaceId" value={id} />
        <label>
          <span>{t("name")}</span>
          <input
            className="input"
            name="workspaceName"
            value={currentName}
            onChange={(e) => setCurrentName(e.target.value)}
            required
          />
        </label>
        <label>
          <span>{t("slug")}</span>
          <input
            className="input"
            name="workspaceSlug"
            value={currentSlug}
            onChange={(e) => setCurrentSlug(e.target.value)}
            required
          />
        </label>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            className={`button buttonPill${isDirty ? " buttonPillSave" : ""}`}
            type="submit"
            disabled={!isDirty || updatePending}
          >
            {updatePending ? t("saving") : t("save")}
          </button>
          {updateState?.error ? (
            <span className="meta workspaceError">{updateState.error}</span>
          ) : null}
        </div>
      </form>

      <SlideOutPanel
        title={t("delete_title")}
        eyebrow={t("delete_eyebrow")}
        description={t("delete_description", { name })}
        trigger={({ open, triggerId }) => {
          closeRef.current = null;
          return isActive ? (
            <button
              id={triggerId}
              type="button"
              className="button buttonPill"
              style={{ justifyContent: "center" }}
              disabled
              title={t("delete_disabled_title")}
            >
              {t("delete")}
            </button>
          ) : (
            <button
              id={triggerId}
              type="button"
              className="button buttonPill buttonPillDanger"
              style={{ justifyContent: "center" }}
              onClick={open}
            >
              {t("delete")}
            </button>
          );
        }}
      >
        <form
          action={deleteWorkspaceAdmin}
          style={{ display: "grid", gap: "14px" }}
          onSubmit={() => {
            setConfirmText("");
          }}
        >
          <input type="hidden" name="workspaceId" value={id} />
          <label>
            <span>{t("confirm_label")}</span>
            <input
              className="input"
              name="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </label>
          <button
            className="button buttonPill buttonPillDanger"
            type="submit"
            disabled={!canDelete}
          >
            {t("permanently_delete")}
          </button>
        </form>
      </SlideOutPanel>
    </article>
  );
}
