"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, X } from "lucide-react";
import { resolveErrorMessage } from "@/lib/errors/coded-error";
import { addRuleAction, removeRuleAction } from "./alerting-actions";
import type { AlertingRule, AlertingIntegration } from "@/lib/domains/alerting/service";
import { getBadgeClass, type SharedHandlerContext } from "./alerting-shared";

interface RuleFormState {
  name: string;
  connector: string;
  minRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "";
  minFrequency: number;
  frequencyWindow: string;
  integrationId: string;
}

export function RuleModal({
  form,
  update,
  integrations,
  error,
  loading,
  onSubmit,
  onClose,
}: {
  form: RuleFormState;
  update: (patch: Partial<RuleFormState>) => void;
  integrations: AlertingIntegration[];
  error: string | null;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const t = useTranslations("alerting");
  return (
    <>
      <div className="modalOverlay" onClick={onClose} />
      <div className="alertingModal">
        <div className="modalHeader">
          <h3>{t("rule.modal_title")}</h3>
          <button className="closeButton" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {error && <div style={{ color: "var(--block)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="formGroup">
            <label htmlFor="rule-name">{t("rule.name")}</label>
            <input
              id="rule-name"
              type="text"
              className="formInput"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={t("rule.name_ph")}
              required
            />
          </div>
          <div className="formRow">
            <div className="formGroup">
              <label htmlFor="rule-conn">{t("rule.connector")}</label>
              <input
                id="rule-conn"
                type="text"
                className="formInput"
                value={form.connector}
                onChange={(e) => update({ connector: e.target.value })}
                placeholder={t("rule.connector_ph")}
              />
            </div>
            <div className="formGroup">
              <label htmlFor="rule-risk">{t("rule.min_risk")}</label>
              <select
                id="rule-risk"
                className="formSelect"
                value={form.minRiskLevel}
                onChange={(e) => update({ minRiskLevel: e.target.value as RuleFormState["minRiskLevel"] })}
              >
                <option value="">{t("rule.risk_all")}</option>
                <option value="LOW">{t("rule.risk_low")}</option>
                <option value="MEDIUM">{t("rule.risk_medium")}</option>
                <option value="HIGH">{t("rule.risk_high")}</option>
                <option value="CRITICAL">{t("rule.risk_critical")}</option>
              </select>
            </div>
          </div>
          <div className="formRow">
            <div className="formGroup">
              <label htmlFor="rule-freq">{t("rule.min_occurrences")}</label>
              <input
                id="rule-freq"
                type="number"
                min={1}
                className="formInput"
                value={form.minFrequency}
                onChange={(e) => update({ minFrequency: parseInt(e.target.value, 10) })}
              />
            </div>
            <div className="formGroup">
              <label htmlFor="rule-wind">{t("rule.window")}</label>
              <input
                id="rule-wind"
                type="number"
                min={1}
                className="formInput"
                value={form.frequencyWindow}
                onChange={(e) => update({ frequencyWindow: e.target.value })}
                placeholder={t("rule.window_ph")}
                required={form.minFrequency > 1}
              />
            </div>
          </div>
          <div className="formGroup">
            <label htmlFor="rule-int">{t("rule.target_channel")}</label>
            <select
              id="rule-int"
              className="formSelect"
              value={form.integrationId}
              onChange={(e) => update({ integrationId: e.target.value })}
              required
            >
              {integrations.map((int) => (
                <option value={int.id} key={int.id}>
                  {int.name} ({int.type})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="submitButton" disabled={loading}>
            {loading ? t("rule.creating") : t("rule.save")}
          </button>
        </form>
      </div>
    </>
  );
}

export function RulesPane({
  rules,
  status,
  deletingId,
  onAdd,
  onRemove,
}: {
  rules: AlertingRule[];
  status: string | null;
  deletingId: string | null;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("alerting");
  return (
    <div className="pane">
      <div className="paneHeader">
        <h2>{t("rule.pane_title")}</h2>
        <button className="addButton" onClick={onAdd}>
          <Plus size={14} /> {t("rule.add")}
        </button>
      </div>
      {status ? <p className="meta adminMutationSuccess">{status}</p> : null}

      {rules.length === 0 ? (
        <div className="emptyState">
          <p>{t("rule.empty_title")}</p>
          <p className="meta" style={{ marginTop: 4 }}>{t("rule.empty_body")}</p>
        </div>
      ) : (
        <div className="denseList">
          {rules.map((rule) => (
            <div className="denseItem" key={rule.id}>
              <div className="itemInfo">
                <div className="itemTitle">
                  <span>{rule.name}</span>
                  {rule.enabled ? (
                    <span className="pill pillAllow" style={{ fontSize: 9, padding: "1px 4px" }}>{t("rule.active")}</span>
                  ) : (
                    <span className="pill" style={{ fontSize: 9, padding: "1px 4px" }}>{t("rule.disabled")}</span>
                  )}
                </div>
                <div className="itemMeta" style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                  <div>
                    {t("rule.connector_label")} <strong style={{ color: "var(--ink)" }}>{rule.connector || t("rule.all")}</strong>
                    {" · "}
                    {t("rule.min_risk_label")} <strong style={{ color: "var(--ink)" }}>{rule.minRiskLevel || t("rule.all")}</strong>
                  </div>
                  <div>
                    {t("rule.frequency_label")} <strong style={{ color: "var(--ink)" }}>
                      {rule.minFrequency > 1
                        ? t("rule.freq_threshold", { count: rule.minFrequency, minutes: rule.frequencyWindowMinutes || 1 })
                        : t("rule.freq_every")}
                    </strong>
                  </div>
                  <div>
                    {t("rule.target_label")} <span className={getBadgeClass(rule.integrationType || "")} style={{ fontSize: 9, padding: "1px 4px" }}>{rule.integrationName || t("rule.unknown")}</span>
                  </div>
                </div>
              </div>
              <div className="itemActions">
                <button
                  className="deleteButton"
                  disabled={deletingId === rule.id}
                  onClick={() => onRemove(rule.id)}
                  title={t("rule.delete_title")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_RULE_FORM: RuleFormState = {
  name: "",
  connector: "",
  minRiskLevel: "",
  minFrequency: 1,
  frequencyWindow: "",
  integrationId: "",
};

// Rule form state, mutation handlers, and modal visibility.
export function useRuleHandlers(ctx: SharedHandlerContext, integrations: AlertingIntegration[]) {
  const t = useTranslations("alerting");
  const tErr = useTranslations("errors");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const updateForm = (patch: Partial<RuleFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.integrationId) {
      ctx.setError(t("rule.name_int_required"));
      return;
    }
    ctx.setLoading(true);
    ctx.setError(null);
    setStatus(null);
    try {
      const windowVal = form.frequencyWindow ? parseInt(form.frequencyWindow, 10) : null;
      await addRuleAction(
        ctx.workspaceId,
        ctx.workspaceSlug,
        form.name,
        true, // enabled
        form.connector || null,
        form.minRiskLevel || null,
        form.minFrequency,
        windowVal,
        form.integrationId
      );
      setForm(EMPTY_RULE_FORM);
      setModalOpen(false);
      setStatus(t("rule.saved"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("rule.add_failed")));
    } finally {
      ctx.setLoading(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm(t("rule.remove_confirm"))) return;
    setDeletingId(id);
    setStatus(null);
    ctx.setError(null);
    try {
      await removeRuleAction(ctx.workspaceId, ctx.workspaceSlug, id);
      setStatus(t("rule.removed"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("rule.remove_failed")));
    } finally {
      setDeletingId(null);
    }
  }

  function openModal() {
    if (integrations.length === 0) {
      alert(t("rule.need_integration"));
      return;
    }
    ctx.setError(null);
    updateForm({ integrationId: integrations[0].id });
    setModalOpen(true);
  }

  return { modalOpen, setModalOpen, form, updateForm, status, deletingId, handleAdd, handleRemove, openModal };
}
