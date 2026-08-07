"use client";

import type { ReactNode } from "react";
import { Bot, Check, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";

const fieldStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 7,
  color: "var(--text)",
  fontSize: 13,
  padding: "7px 9px",
} as const;

export function RecommendationGenerateForm({
  action,
  buttonLabel,
  children,
  disabled,
  error,
  pending,
  pendingLabel,
  title,
}: {
  action: (payload: FormData) => void;
  buttonLabel: string;
  children: ReactNode;
  disabled?: boolean;
  error?: string;
  pending?: boolean;
  pendingLabel: string;
  title: string;
}) {
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      {children}
      <button
        className="button buttonSmall"
        disabled={disabled}
        style={{ alignSelf: "start" }}
        title={title}
        type="submit"
      >
        <Bot size={14} />
        {pending ? pendingLabel : buttonLabel}
      </button>
      {error ? (
        <p className="meta" style={{ color: "var(--block)" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function RecommendationCard({
  children,
  rationale,
  summary,
  title,
}: {
  children: ReactNode;
  rationale: string[];
  summary: string;
  title: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        display: "grid",
        gap: 8,
        padding: 10,
      }}
    >
      <div>{title}</div>
      <p className="meta" style={{ color: "var(--text)" }}>
        {summary}
      </p>
      {children}
      <ul style={{ display: "grid", gap: 4, margin: 0, paddingLeft: 16 }}>
        {rationale.map((reason) => (
          <li className="meta" key={reason}>
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecommendationDecisionForm({
  action,
  applying,
  editedSummary,
  error,
  hiddenFields,
  onEditedSummaryChange,
  rationaleId,
  summaryId,
}: {
  action: (payload: FormData) => void;
  applying: boolean;
  editedSummary: string;
  error?: string;
  hiddenFields: ReactNode;
  onEditedSummaryChange: (value: string) => void;
  rationaleId: string;
  summaryId: string;
}) {
  const t = useTranslations("shared.recommendation_decision");
  const hasEditedSummary = editedSummary.trim().length > 0;

  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      {hiddenFields}

      <label className="metadata" htmlFor={summaryId}>
        {t("edited_summary")}
      </label>
      <textarea
        id={summaryId}
        name="editedSummary"
        onChange={(event) => onEditedSummaryChange(event.target.value)}
        placeholder={t("edited_summary_placeholder")}
        rows={2}
        style={{ ...fieldStyle, resize: "vertical" }}
        value={editedSummary}
      />

      <label className="metadata" htmlFor={rationaleId}>
        {t("reviewer_rationale")}
      </label>
      <textarea
        id={rationaleId}
        name="rationale"
        placeholder={t("rationale_placeholder")}
        required
        rows={2}
        style={{ ...fieldStyle, resize: "vertical" }}
      />

      {error ? (
        <p className="meta" style={{ color: "var(--block)" }}>
          {error}
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button
          className="button buttonPrimary buttonSmall"
          disabled={applying}
          name="decision"
          type="submit"
          value={hasEditedSummary ? "EDIT" : "ACCEPT"}
        >
          {hasEditedSummary ? <Pencil size={13} /> : <Check size={13} />}
          {hasEditedSummary ? t("edit_record") : t("accept")}
        </button>
        <button
          className="button buttonSmall"
          disabled={applying}
          name="decision"
          type="submit"
          value="REJECT"
        >
          <X size={13} />
          {t("reject")}
        </button>
      </div>
    </form>
  );
}

export function RecommendationPillRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>;
}
