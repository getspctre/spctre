"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, X } from "lucide-react";
import { resolveErrorMessage } from "@/lib/errors/coded-error";
import { addIntegrationAction, removeIntegrationAction } from "./alerting-actions";
import type { AlertingIntegration } from "@/lib/domains/alerting/service";
import { getBadgeClass, type SharedHandlerContext } from "./alerting-shared";

type IntegrationType = "SLACK" | "PAGERDUTY" | "TEAMS" | "EMAIL" | "WEBHOOK" | "SPLUNK_HEC" | "SENTINEL";
type AlertingT = ReturnType<typeof useTranslations>;

interface IntegrationFormState {
  name: string;
  type: IntegrationType;
  url: string;
  routingKey: string;
  splunkToken: string;
  sentinelPrimaryKey: string;
  sentinelLogType: string;
}

function validateIntegrationForm(form: IntegrationFormState, t: AlertingT): string | null {
  if (!form.name) return t("validate.channel_name");
  if (form.type === "PAGERDUTY" && !form.routingKey) return t("validate.pagerduty_key");
  if (form.type === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.url)) {
    return t("validate.valid_email");
  }
  if (form.type === "SPLUNK_HEC" && (!form.url || !form.splunkToken)) {
    return t("validate.splunk");
  }
  if (form.type === "SENTINEL" && (!form.url || !form.sentinelPrimaryKey)) {
    return t("validate.sentinel");
  }
  if (!["PAGERDUTY", "SPLUNK_HEC", "SENTINEL"].includes(form.type) && !form.url) {
    return form.type === "EMAIL" ? t("validate.recipient_email") : t("validate.endpoint_url");
  }
  return null;
}

function buildIntegrationPayload(form: IntegrationFormState): { url: string; config: Record<string, unknown> } {
  if (form.type === "PAGERDUTY") {
    return { url: "https://events.pagerduty.com/v2/enqueue", config: { routingKey: form.routingKey } };
  }
  if (form.type === "SPLUNK_HEC") {
    return { url: form.url, config: { token: form.splunkToken } };
  }
  if (form.type === "SENTINEL") {
    return {
      url: form.url,
      config: {
        primaryKey: form.sentinelPrimaryKey,
        logType: form.sentinelLogType || "SpctrePolicyEvent",
      },
    };
  }
  return { url: form.url, config: {} };
}

// Endpoint fields that vary by integration platform type.
function IntegrationEndpointFields({
  form,
  update,
}: {
  form: IntegrationFormState;
  update: (patch: Partial<IntegrationFormState>) => void;
}) {
  const t = useTranslations("alerting");
  if (form.type === "PAGERDUTY") {
    return (
      <div className="formGroup">
        <label htmlFor="int-routing-key">{t("int.routing_key")}</label>
        <input
          id="int-routing-key"
          type="text"
          className="formInput"
          value={form.routingKey}
          onChange={(e) => update({ routingKey: e.target.value })}
          placeholder={t("int.routing_key_ph")}
          required
        />
      </div>
    );
  }
  if (form.type === "SPLUNK_HEC") {
    return (
      <>
        <div className="formGroup">
          <label htmlFor="int-url">{t("int.hec_url")}</label>
          <input
            id="int-url"
            type="url"
            className="formInput"
            value={form.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="https://splunk.yourcompany.com:8088/services/collector/event"
            required
          />
        </div>
        <div className="formGroup">
          <label htmlFor="int-splunk-token">{t("int.hec_token")}</label>
          <input
            id="int-splunk-token"
            type="password"
            className="formInput"
            value={form.splunkToken}
            onChange={(e) => update({ splunkToken: e.target.value })}
            placeholder={t("int.hec_token_ph")}
            required
          />
        </div>
      </>
    );
  }
  if (form.type === "SENTINEL") {
    return (
      <>
        <div className="formGroup">
          <label htmlFor="int-url">{t("int.workspace_id")}</label>
          <input
            id="int-url"
            type="text"
            className="formInput"
            value={form.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            required
          />
        </div>
        <div className="formGroup">
          <label htmlFor="int-sentinel-key">{t("int.primary_key")}</label>
          <input
            id="int-sentinel-key"
            type="password"
            className="formInput"
            value={form.sentinelPrimaryKey}
            onChange={(e) => update({ sentinelPrimaryKey: e.target.value })}
            placeholder={t("int.primary_key_ph")}
            required
          />
        </div>
        <div className="formGroup">
          <label htmlFor="int-sentinel-log-type">{t("int.log_type")}</label>
          <input
            id="int-sentinel-log-type"
            type="text"
            className="formInput"
            value={form.sentinelLogType}
            onChange={(e) => update({ sentinelLogType: e.target.value })}
            placeholder="SpctrePolicyEvent"
          />
        </div>
      </>
    );
  }
  return (
    <div className="formGroup">
      <label htmlFor="int-url">{t("int.endpoint_url")}</label>
      <input
        id="int-url"
        type="url"
        className="formInput"
        value={form.url}
        onChange={(e) => update({ url: e.target.value })}
        placeholder={t("int.endpoint_url_ph")}
        required
      />
    </div>
  );
}

export function IntegrationModal({
  form,
  update,
  error,
  loading,
  onSubmit,
  onClose,
}: {
  form: IntegrationFormState;
  update: (patch: Partial<IntegrationFormState>) => void;
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
          <h3>{t("int.modal_title")}</h3>
          <button className="closeButton" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {error && <div style={{ color: "var(--block)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="formGroup">
            <label htmlFor="int-name">{t("int.channel_name")}</label>
            <input
              id="int-name"
              type="text"
              className="formInput"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={t("int.channel_name_ph")}
              required
            />
          </div>
          <div className="formGroup">
            <label htmlFor="int-type">{t("int.platform_type")}</label>
            <select
              id="int-type"
              className="formSelect"
              value={form.type}
              onChange={(e) => update({ type: e.target.value as IntegrationType })}
            >
              <option value="SLACK">{t("int.opt_slack")}</option>
              <option value="TEAMS">{t("int.opt_teams")}</option>
              <option value="EMAIL">{t("int.opt_email")}</option>
              <option value="PAGERDUTY">{t("int.opt_pagerduty")}</option>
              <option value="WEBHOOK">{t("int.opt_webhook")}</option>
              <option value="SPLUNK_HEC">{t("int.opt_splunk")}</option>
              <option value="SENTINEL">{t("int.opt_sentinel")}</option>
            </select>
          </div>
          <IntegrationEndpointFields form={form} update={update} />
          <button type="submit" className="submitButton" disabled={loading}>
            {loading ? t("int.adding") : t("int.save")}
          </button>
        </form>
      </div>
    </>
  );
}

export function IntegrationsPane({
  integrations,
  status,
  deletingId,
  onAdd,
  onRemove,
}: {
  integrations: AlertingIntegration[];
  status: string | null;
  deletingId: string | null;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("alerting");
  return (
    <div className="pane">
      <div className="paneHeader">
        <h2>{t("int.pane_title")}</h2>
        <button className="addButton" onClick={onAdd}>
          <Plus size={14} /> {t("int.add_channel")}
        </button>
      </div>
      {status ? <p className="meta adminMutationSuccess">{status}</p> : null}

      {integrations.length === 0 ? (
        <div className="emptyState">
          <p>{t("int.empty_title")}</p>
          <p className="meta" style={{ marginTop: 4 }}>{t("int.empty_body")}</p>
        </div>
      ) : (
        <div className="denseList">
          {integrations.map((integration) => (
            <div className="denseItem" key={integration.id}>
              <div className="itemInfo">
                <div className="itemTitle">
                  <span>{integration.name}</span>
                  <span className={getBadgeClass(integration.type)}>{integration.type}</span>
                </div>
                <div className="itemMeta">{integration.url}</div>
              </div>
              <div className="itemActions">
                <button
                  className="deleteButton"
                  disabled={deletingId === integration.id}
                  onClick={() => onRemove(integration.id)}
                  title={t("int.delete_title")}
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

const EMPTY_INTEGRATION_FORM: IntegrationFormState = {
  name: "",
  type: "SLACK",
  url: "",
  routingKey: "",
  splunkToken: "",
  sentinelPrimaryKey: "",
  sentinelLogType: "",
};

// Integration form state, mutation handlers, and modal visibility.
export function useIntegrationHandlers(ctx: SharedHandlerContext) {
  const t = useTranslations("alerting");
  const tErr = useTranslations("errors");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<IntegrationFormState>(EMPTY_INTEGRATION_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const updateForm = (patch: Partial<IntegrationFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateIntegrationForm(form, t);
    if (validationError) {
      ctx.setError(validationError);
      return;
    }

    ctx.setLoading(true);
    ctx.setError(null);
    setStatus(null);
    try {
      const { url, config } = buildIntegrationPayload(form);
      await addIntegrationAction(ctx.workspaceId, ctx.workspaceSlug, form.name, form.type, url, config);
      setForm((prev) => ({ ...EMPTY_INTEGRATION_FORM, type: prev.type }));
      setModalOpen(false);
      setStatus(t("int.saved"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("int.add_failed")));
    } finally {
      ctx.setLoading(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm(t("int.remove_confirm"))) return;
    setDeletingId(id);
    setStatus(null);
    ctx.setError(null);
    try {
      await removeIntegrationAction(ctx.workspaceId, ctx.workspaceSlug, id);
      setStatus(t("int.removed"));
    } catch (err: unknown) {
      ctx.setError(resolveErrorMessage(err, tErr, t("int.remove_failed")));
    } finally {
      setDeletingId(null);
    }
  }

  return { modalOpen, setModalOpen, form, updateForm, status, deletingId, handleAdd, handleRemove };
}
