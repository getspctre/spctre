"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { inviteOrganizationMember } from "./member-actions";
import type { MemberActionState } from "@/lib/domains/members/service";
import { ORG_ROLES, roleDefinition } from "@/lib/rbac";

const initialState: MemberActionState = null;

export function InviteMemberForm() {
  const t = useTranslations("admin.members.invite_form");
  const [state, action, pending] = useActionState(inviteOrganizationMember, initialState);

  return (
    <form action={action} className="adminAuthForm">
      <div className="adminAuthFormIntro">
        <h3>{t("title")}</h3>
        <p className="meta">{t("description")}</p>
      </div>

      <div className="adminAuthTwoColumn">
        <label className="field">
          <span>{t("display_name")}</span>
          <input className="input" name="displayName" placeholder={t("display_name_placeholder")} required />
        </label>
        <label className="field">
          <span>{t("email")}</span>
          <input className="input" name="email" type="email" placeholder={t("email_placeholder")} required />
        </label>
      </div>

      <label className="field">
        <span>{t("organization_role")}</span>
        <select className="input" name="orgRole" defaultValue="REVIEWER">
          {ORG_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleDefinition(role).label}
            </option>
          ))}
        </select>
      </label>

      <button className="button buttonPrimary" type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </button>

      {state?.error ? <p className="meta workspaceError">{state.error}</p> : null}
      {state?.ok ? <p className="meta">{state.message}</p> : null}
    </form>
  );
}
