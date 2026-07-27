"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { upsertIdentityProvider } from "./idp-actions";
import type { AdminAuthActionState } from "./shared-actions";
import type { IdentityProviderSummary } from "@/lib/domains/auth/service";

import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useFeatureFlag } from "@/app/feature-flags";

interface IdpFormProps {
  existing?: IdentityProviderSummary;
}

const initialState: AdminAuthActionState = null;

function FormStatus({ state }: { state: AdminAuthActionState }) {
  const t = useTranslations("admin.auth.idp.status");
  return (
    <>
      {state?.error ? <p className="meta workspaceError">{state.errorCode ? t(state.errorCode) : state.error}</p> : null}
      {state?.ok ? <p className="meta">{state.messageCode ? t(state.messageCode) : state.message}</p> : null}
    </>
  );
}

function SamlUpgradePrompt() {
  const t = useTranslations("admin.auth.idp");
  return (
    <div className="upgradePrompt upgradePromptInline">
      <div>
        <p className="eyebrow">{FEATURE_FLAGS.samlScimProvisioning.minimumPlan} plan</p>
        <h3>{FEATURE_FLAGS.samlScimProvisioning.label}</h3>
        <p className="meta">{FEATURE_FLAGS.samlScimProvisioning.description}</p>
      </div>
      <a className="button" href="/usage-billing">
        {t("view_plans")}
      </a>
    </div>
  );
}

function submitLabel(t: ReturnType<typeof useTranslations>, pending: boolean, editing: boolean): string {
  if (pending) return t("saving");
  return editing ? t("save_provider") : t("add_provider");
}

function SamlFields({ existing }: { existing?: IdentityProviderSummary }) {
  const t = useTranslations("admin.auth.idp");
  return (
    <>
      <label className="field">
        <span>{t("saml_entry_point")}</span>
        <input
          className="input"
          name="samlEntryPoint"
          defaultValue={existing?.samlEntryPoint ?? ""}
          placeholder="https://idp.example.com/saml/sso"
          required
        />
      </label>

      <label className="field">
        <span>
          {existing ? t("saml_cert_keep") : t("saml_cert")}
        </span>
        <textarea
          className="input codearea"
          name="samlCert"
          defaultValue=""
          rows={6}
          placeholder={t("saml_cert_placeholder")}
        />
      </label>
    </>
  );
}

function OidcFields({ existing }: { existing?: IdentityProviderSummary }) {
  const t = useTranslations("admin.auth.idp");
  return (
    <>
      <label className="field">
        <span>{t("client_id")}</span>
        <input
          className="input"
          name="clientId"
          defaultValue={existing?.clientId ?? ""}
          required
        />
      </label>

      <label className="field">
        <span>{existing ? t("client_secret_keep") : t("client_secret")}</span>
        <input className="input" name="clientSecret" type="password" defaultValue="" />
      </label>

      <label className="field">
        <span>{t("scope")}</span>
        <input
          className="input"
          name="scope"
          defaultValue={existing?.scope ?? "openid profile email"}
        />
      </label>

      <label className="field">
        <span>{t("metadata_url")}</span>
        <input
          className="input"
          name="metadataUrl"
          defaultValue={existing?.metadataUrl ?? ""}
        />
      </label>
    </>
  );
}

export function IdpForm({ existing }: IdpFormProps) {
  const t = useTranslations("admin.auth.idp");
  const [state, action, pending] = useActionState(upsertIdentityProvider, initialState);
  const canUseSaml = useFeatureFlag("samlScimProvisioning");
  const [providerType, setProviderType] = useState<"OIDC" | "SAML">(
    existing?.providerType === "SAML" && canUseSaml ? "SAML" : "OIDC"
  );

  const isSaml = providerType === "SAML";

  return (
    <form action={action} className="adminAuthForm">
      <div className="adminAuthFormIntro">
        <h3>{existing ? t("edit_title") : t("add_title")}</h3>
        <p className="meta">{t("description")}</p>
      </div>

      <input type="hidden" name="providerId" value={existing?.id ?? ""} />

      <label className="field">
        <span>{t("provider_type")}</span>
        <select
          className="input"
          name="providerType"
          defaultValue={existing?.providerType ?? "OIDC"}
          onChange={(e) => setProviderType(e.target.value as "OIDC" | "SAML")}
          disabled={Boolean(existing)}
        >
          <option value="OIDC">OIDC</option>
          <option value="SAML" disabled={!canUseSaml}>SAML 2.0</option>
        </select>
      </label>

      {!canUseSaml ? <SamlUpgradePrompt /> : null}

      <label className="field">
        <span>{t("name")}</span>
        <input className="input" name="name" defaultValue={existing?.name ?? ""} required />
      </label>

      <label className="field">
        <span>{isSaml ? t("saml_entity_id") : t("issuer")}</span>
        <input className="input" name="issuer" defaultValue={existing?.issuer ?? ""} required />
      </label>

      {isSaml ? <SamlFields existing={existing} /> : <OidcFields existing={existing} />}

      <button className="button buttonPrimary" type="submit" disabled={pending}>
        {submitLabel(t, pending, Boolean(existing))}
      </button>

      <FormStatus state={state} />

      {isSaml ? (
        <p className="meta adminAuthHelpText">
          {t("saml_help_prefix")}{" "}
          <a href="/api/auth/saml/metadata" target="_blank" rel="noreferrer">
            /api/auth/saml/metadata
          </a>{" "}
          {t("saml_help_suffix")}
        </p>
      ) : null}
    </form>
  );
}
