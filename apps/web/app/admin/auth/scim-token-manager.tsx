"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createScimProvisioningToken,
  revokeScimProvisioningToken,
  type ScimTokenActionState,
  type ScimTokenMutationState,
} from "./scim-token-actions";

export interface ScimTokenRow {
  id: string;
  label: string | null;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function RevokeScimTokenForm({ id }: { id: string }) {
  const t = useTranslations("admin.auth.scim.tokens");
  const [state, formAction, isPending] = useActionState<ScimTokenMutationState, FormData>(
    revokeScimProvisioningToken,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      {state?.error && (
        <p className="meta serviceKeyTokenRevealWarn">
          {state.errorCode ? t(`status.${state.errorCode}`) : state.error}
        </p>
      )}
      <button type="submit" className="button" disabled={isPending}>
        {t("revoke")}
      </button>
    </form>
  );
}

export function ScimTokenManager({
  tokens,
  scimEndpoint,
}: {
  tokens: ScimTokenRow[];
  scimEndpoint: string;
}) {
  const t = useTranslations("admin.auth.scim.tokens");
  const [state, formAction, isPending] = useActionState<ScimTokenActionState, FormData>(
    createScimProvisioningToken,
    null,
  );
  const [copied, setCopied] = useState(false);

  function copyToken(token: string) {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="adminAuthList">
      <p className="meta">
        {t("endpoint_hint")} <code>{scimEndpoint}</code>
      </p>

      {state?.ok ? (
        <div className="serviceKeyTokenReveal">
          <p className="serviceKeyTokenRevealWarn">{t("copy_warning")}</p>
          <div className="serviceKeyTokenDisplay">
            <code className="serviceKeyTokenCode">{state.token}</code>
            <button type="button" className="button" onClick={() => copyToken(state.token)}>
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
        </div>
      ) : (
        <form action={formAction} className="adminAuthForm">
          {state?.error && (
            <p className="meta serviceKeyTokenRevealWarn">
              {state.errorCode ? t(`status.${state.errorCode}`) : state.error}
            </p>
          )}
          <div className="formField">
            <label htmlFor="scim-token-label" className="eyebrow">
              {t("label")}
            </label>
            <input
              id="scim-token-label"
              name="label"
              className="input"
              placeholder={t("label_placeholder")}
              maxLength={120}
            />
          </div>
          <button type="submit" className="button" disabled={isPending}>
            {isPending ? t("generating") : t("generate")}
          </button>
        </form>
      )}

      {tokens.length ? (
        <div className="auditTableWrapper">
          <table className="auditTable">
            <thead>
              <tr>
                <th>{t("label")}</th>
                <th>{t("created_by")}</th>
                <th>{t("created")}</th>
                <th>{t("last_used")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td>{token.label ?? "—"}</td>
                  <td>{token.createdBy}</td>
                  <td>{new Date(token.createdAt).toLocaleDateString()}</td>
                  <td>
                    {token.lastUsedAt
                      ? new Date(token.lastUsedAt).toLocaleDateString()
                      : t("never_used")}
                  </td>
                  <td>
                    <RevokeScimTokenForm id={token.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="meta">{t("empty")}</p>
      )}
    </div>
  );
}
