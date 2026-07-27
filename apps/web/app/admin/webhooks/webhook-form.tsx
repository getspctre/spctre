"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { createGatewayWebhook, type WebhookActionState } from "./actions";

export interface WebhookProviderOption {
  id: string;
  label: string;
  header: string;
}

export function WebhookForm({ providers }: { providers: WebhookProviderOption[] }) {
  const t = useTranslations("admin.webhooks.form");
  const [state, formAction, isPending] = useActionState<WebhookActionState, FormData>(
    createGatewayWebhook,
    null
  );
  const [copied, setCopied] = useState(false);

  function copySecret(secret: string) {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (state?.ok) {
    const meta = providers.find((provider) => provider.id === state.provider);
    return (
      <div className="adminAuthPanel">
        <div className="adminAuthPanelHeader">
          <div>
            <p className="eyebrow">{t("created_eyebrow")}</p>
            <h2>{meta?.label ?? state.provider}{state.label ? ` — ${state.label}` : ""}</h2>
          </div>
        </div>
        <div className="serviceKeyTokenReveal">
          <p className="serviceKeyTokenRevealWarn">
            {t("copy_warning")}
          </p>
          <div className="serviceKeyTokenDisplay">
            <code className="serviceKeyTokenCode">{state.secret}</code>
            <button
              type="button"
              className="button"
              onClick={() => copySecret(state.secret)}
            >
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
          <p className="meta">
            {t("configure_prefix", { provider: meta?.label ?? state.provider })}{" "}
            <code>{meta?.header ?? "x-spctre-gateway-secret"}</code> {t("configure_header_suffix")}
            {" "}{t("configure_generic_prefix")} <code>x-spctre-gateway-secret</code>{" "}
            {t("configure_generic_suffix")}
          </p>
        </div>
        <div className="adminAuthPanelActions">
          <a href="/admin/webhooks" className="button">{t("done")}</a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="adminAuthForm">
      {state?.error && (
        <p className="meta serviceKeyTokenRevealWarn">{state.errorCode ? t(`status.${state.errorCode}`) : state.error}</p>
      )}

      <div className="formField">
        <label htmlFor="webhook-provider" className="eyebrow">{t("provider")}</label>
        <select id="webhook-provider" name="provider" className="input" required defaultValue={providers[0]?.id}>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.label}</option>
          ))}
        </select>
      </div>

      <div className="formField">
        <label htmlFor="webhook-label" className="eyebrow">
          {t("label")} <span className="meta">{t("label_hint")}</span>
        </label>
        <input
          id="webhook-label"
          name="label"
          type="text"
          className="input"
          placeholder={t("label_placeholder")}
          maxLength={64}
          autoComplete="off"
        />
      </div>

      <div className="adminAuthPanelActions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? t("generating") : t("generate")}
        </button>
      </div>
    </form>
  );
}
