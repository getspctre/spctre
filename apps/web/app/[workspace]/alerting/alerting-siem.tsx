"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Power, Trash2, X } from "lucide-react";
import { resolveErrorMessage } from "@/lib/errors/coded-error";
import { addSiemStreamAction, removeSiemStreamAction, toggleSiemStreamAction } from "./siem-stream-actions";
import type { SiemStream } from "@/lib/domains/siem-stream/service";
import type { SharedHandlerContext } from "./alerting-shared";

interface SiemFormState {
  name: string;
  type: "SPLUNK_HEC" | "SENTINEL";
  url: string;
  splunkToken: string;
  sentinelPrimaryKey: string;
  sentinelLogType: string;
}

export function SiemStreamModal({
  form,
  update,
  error,
  loading,
  onSubmit,
  onClose,
}: {
  form: SiemFormState;
  update: (patch: Partial<SiemFormState>) => void;
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
          <h3>{t("siem.modal_title")}</h3>
          <button className="closeButton" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {error && <div style={{ color: "var(--block)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="formGroup">
            <label htmlFor="siem-name">{t("siem.stream_name")}</label>
            <input
              id="siem-name"
              type="text"
              className="formInput"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={t("siem.stream_name_ph")}
              required
            />
          </div>
          <div className="formGroup">
            <label htmlFor="siem-type">{t("siem.destination")}</label>
            <select
              id="siem-type"
              className="formSelect"
              value={form.type}
              onChange={(e) => update({ type: e.target.value as "SPLUNK_HEC" | "SENTINEL" })}
            >
              <option value="SPLUNK_HEC">{t("int.opt_splunk")}</option>
              <option value="SENTINEL">{t("int.opt_sentinel")}</option>
            </select>
          </div>
          {form.type === "SPLUNK_HEC" ? (
            <>
              <div className="formGroup">
                <label htmlFor="siem-url">{t("siem.hec_url")}</label>
                <input
                  id="siem-url"
                  type="url"
                  className="formInput"
                  value={form.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="https://splunk.yourcompany.com:8088/services/collector/event"
                  required
                />
              </div>
              <div className="formGroup">
                <label htmlFor="siem-splunk-token">{t("siem.hec_token")}</label>
                <input
                  id="siem-splunk-token"
                  type="password"
                  className="formInput"
                  value={form.splunkToken}
                  onChange={(e) => update({ splunkToken: e.target.value })}
                  placeholder={t("siem.hec_token_ph")}
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="formGroup">
                <label htmlFor="siem-url">{t("siem.workspace_id")}</label>
                <input
                  id="siem-url"
                  type="text"
                  className="formInput"
                  value={form.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  required
                />
              </div>
              <div className="formGroup">
                <label htmlFor="siem-sentinel-key">{t("siem.primary_key")}</label>
                <input
                  id="siem-sentinel-key"
                  type="password"
                  className="formInput"
                  value={form.sentinelPrimaryKey}
                  onChange={(e) => update({ sentinelPrimaryKey: e.target.value })}
                  placeholder={t("siem.primary_key_ph")}
                  required
                />
              </div>
              <div className="formGroup">
                <label htmlFor="siem-sentinel-logtype">{t("siem.log_type")}</label>
                <input
                  id="siem-sentinel-logtype"
                  type="text"
                  className="formInput"
                  value={form.sentinelLogType}
                  onChange={(e) => update({ sentinelLogType: e.target.value })}
                  placeholder="SpctrePolicyEvent"
                />
              </div>
            </>
          )}
          <button type="submit" className="submitButton" disabled={loading}>
            {loading ? t("siem.saving") : t("siem.save")}
          </button>
        </form>
      </div>
    </>
  );
}

export function SiemStreamsSection({
  siemStreams,
  status,
  error,
  deletingId,
  togglingId,
  onAdd,
  onRemove,
  onToggle,
}: {
  siemStreams: SiemStream[];
  status: string | null;
  error: string | null;
  deletingId: string | null;
  togglingId: string | null;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, currentEnabled: boolean) => void;
}) {
  const t = useTranslations("alerting");
  return (
    <div className="siemSection">
      <div className="paneHeader">
        <h2>{t("siem.section_title")}</h2>
        <button className="addButton" onClick={onAdd}>
          <Plus size={14} /> {t("siem.add")}
        </button>
      </div>
      {status ? <p className="meta adminMutationSuccess">{status}</p> : null}
      {error ? <p className="meta workspaceError">{error}</p> : null}

      {siemStreams.length === 0 ? (
        <div className="emptyState">
          <p>{t("siem.empty_title")}</p>
          <p className="meta" style={{ marginTop: 4 }}>{t("siem.empty_body")}</p>
        </div>
      ) : (
        <div className="denseList">
          {siemStreams.map((stream) => (
            <div className="denseItem" key={stream.id}>
              <div className="itemInfo">
                <div className="itemTitle">
                  <span>{stream.name}</span>
                  <span className="badge badgeSiem">{stream.type === "SPLUNK_HEC" ? "Splunk HEC" : "Sentinel"}</span>
                  {stream.enabled ? (
                    <span className="pill pillAllow" style={{ fontSize: 9, padding: "1px 4px" }}>{t("siem.active")}</span>
                  ) : (
                    <span className="pill" style={{ fontSize: 9, padding: "1px 4px" }}>{t("siem.paused")}</span>
                  )}
                </div>
                <div className="itemMeta">
                  {stream.url.length > 60 ? stream.url.slice(0, 57) + "…" : stream.url}
                  {stream.lastForwardedAt ? (
                    <span style={{ marginLeft: 8 }}>
                      {t("siem.last_forwarded", { time: new Date(stream.lastForwardedAt).toLocaleString() })}
                    </span>
                  ) : (
                    <span style={{ marginLeft: 8 }}>{t("siem.not_forwarded")}</span>
                  )}
                </div>
              </div>
              <div className="itemActions">
                <button
                  className="toggleButton"
                  disabled={togglingId === stream.id}
                  onClick={() => onToggle(stream.id, stream.enabled)}
                  title={stream.enabled ? t("siem.pause") : t("siem.resume")}
                >
                  <Power size={14} />
                </button>
                <button
                  className="deleteButton"
                  disabled={deletingId === stream.id}
                  onClick={() => onRemove(stream.id)}
                  title={t("siem.delete_title")}
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

const EMPTY_SIEM_FORM: SiemFormState = {
  name: "",
  type: "SPLUNK_HEC",
  url: "",
  splunkToken: "",
  sentinelPrimaryKey: "",
  sentinelLogType: "",
};

// SIEM stream form state, mutation handlers, and modal visibility.
export function useSiemHandlers(ctx: SharedHandlerContext) {
  const t = useTranslations("alerting");
  const tErr = useTranslations("errors");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<SiemFormState>(EMPTY_SIEM_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const updateForm = (patch: Partial<SiemFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) { ctx.setError(t("siem.name_required")); return; }
    if (form.type === "SPLUNK_HEC" && (!form.url || !form.splunkToken)) {
      ctx.setError(t("validate.splunk")); return;
    }
    if (form.type === "SENTINEL" && (!form.url || !form.sentinelPrimaryKey)) {
      ctx.setError(t("validate.sentinel")); return;
    }
    ctx.setLoading(true);
    ctx.setError(null);
    setStatus(null);
    try {
      const finalConfig: Record<string, unknown> =
        form.type === "SPLUNK_HEC"
          ? {}
          : { logType: form.sentinelLogType || "SpctrePolicyEvent" };
      const finalCredentials: Record<string, unknown> =
        form.type === "SPLUNK_HEC"
          ? { token: form.splunkToken }
          : { primaryKey: form.sentinelPrimaryKey };
      await addSiemStreamAction(ctx.workspaceId, ctx.workspaceSlug, form.name, form.type, form.url, finalConfig, finalCredentials);
      setForm((prev) => ({ ...EMPTY_SIEM_FORM, type: prev.type }));
      setModalOpen(false);
      setStatus(t("siem.saved"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("siem.add_failed")));
    } finally {
      ctx.setLoading(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm(t("siem.remove_confirm"))) return;
    setDeletingId(id);
    setStatus(null);
    ctx.setError(null);
    try {
      await removeSiemStreamAction(ctx.workspaceId, ctx.workspaceSlug, id);
      setStatus(t("siem.removed"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("siem.remove_failed")));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggle(id: string, currentEnabled: boolean) {
    setTogglingId(id);
    setStatus(null);
    ctx.setError(null);
    try {
      await toggleSiemStreamAction(ctx.workspaceId, ctx.workspaceSlug, id, !currentEnabled);
      setStatus(currentEnabled ? t("siem.paused_status") : t("siem.resumed_status"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("siem.toggle_failed")));
    } finally {
      setTogglingId(null);
    }
  }

  return { modalOpen, setModalOpen, form, updateForm, status, deletingId, togglingId, handleAdd, handleRemove, handleToggle };
}
