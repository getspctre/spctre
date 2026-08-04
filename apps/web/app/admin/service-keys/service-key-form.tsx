"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { createServiceKey, type ServiceKeyActionState } from "./actions";

const DEFAULT_SCOPES = new Set([
  "bundle:read",
  "decision:evaluate",
  "evidence:write",
  "heartbeat:write",
]);

export function ServiceKeyForm({ availableScopes }: { availableScopes: string[] }) {
  const t = useTranslations("admin.service_keys.form");
  const [state, formAction, isPending] = useActionState<ServiceKeyActionState, FormData>(
    createServiceKey,
    null,
  );
  const [copied, setCopied] = useState(false);

  function copyToken(token: string) {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (state?.ok) {
    return (
      <div className="adminAuthPanel">
        <div className="adminAuthPanelHeader">
          <div>
            <p className="eyebrow">{t("created_eyebrow")}</p>
            <h2>{state.label}</h2>
          </div>
        </div>
        <div className="serviceKeyTokenReveal">
          <p className="serviceKeyTokenRevealWarn">{t("copy_warning")}</p>
          <div className="serviceKeyTokenDisplay">
            <code className="serviceKeyTokenCode">{state.rawToken}</code>
            <button type="button" className="button" onClick={() => copyToken(state.rawToken)}>
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
          <p className="meta">
            {t("prefix")} <code>{state.tokenPrefix}…</code>
          </p>
        </div>
        <div className="adminAuthPanelActions">
          <a href="/admin/service-keys" className="button">
            {t("done")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="adminAuthForm">
      {state?.error && (
        <p className="meta serviceKeyTokenRevealWarn">
          {state.errorCode ? t(`status.${state.errorCode}`) : state.error}
        </p>
      )}

      <div className="formField">
        <label htmlFor="key-label" className="eyebrow">
          {t("label")}
        </label>
        <input
          id="key-label"
          name="label"
          type="text"
          className="input"
          placeholder={t("label_placeholder")}
          maxLength={64}
          required
          autoComplete="off"
        />
      </div>

      <fieldset className="adminAuthFieldset">
        <legend>{t("scopes")}</legend>
        <div className="adminAuthChipGrid">
          {availableScopes.map((scope) => (
            <label key={scope} className="adminAuthOption">
              <input
                type="checkbox"
                name="scopes"
                value={scope}
                defaultChecked={DEFAULT_SCOPES.has(scope)}
              />
              <span>{scope}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="formField">
        <label htmlFor="key-expires" className="eyebrow">
          {t("expires")} <span className="meta">{t("expires_hint")}</span>
        </label>
        <input
          id="key-expires"
          name="expiresInDays"
          type="number"
          className="input"
          min={1}
          max={365}
          placeholder={t("expires_placeholder")}
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
