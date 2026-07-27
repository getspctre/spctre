"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateTenantMfaSettings } from "./mfa-actions";
import type { AdminAuthActionState } from "./shared-actions";

const initialState: AdminAuthActionState = null;

export function TenantMfaSettingsForm({
  requireMfa,
  mfaGraceDays
}: {
  requireMfa: boolean;
  mfaGraceDays: number;
}) {
  const t = useTranslations("admin.auth.mfa");
  const [state, action, pending] = useActionState(updateTenantMfaSettings, initialState);

  return (
    <form action={action} className="adminAuthForm">
      <div className="adminAuthFormIntro">
        <h3>{t("title")}</h3>
        <p className="meta">{t("description")}</p>
      </div>

      <label className="adminAuthCheck">
        <input type="checkbox" name="requireMfa" defaultChecked={requireMfa} />
        <span>
          <strong>{t("require")}</strong>
          <span className="meta">{t("require_description")}</span>
        </span>
      </label>

      <label className="field">
        <span>{t("grace_days")}</span>
        <input className="input" type="number" min={0} max={365} name="mfaGraceDays" defaultValue={mfaGraceDays} />
      </label>

      <button className="button buttonPrimary" type="submit" disabled={pending}>
        {pending ? t("saving") : t("submit")}
      </button>

      {state?.error ? <p className="meta workspaceError">{state.error}</p> : null}
      {state?.ok ? <p className="meta">{state.messageCode ? t(`status.${state.messageCode}`) : state.message}</p> : null}
    </form>
  );
}
