"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { SlideOutPanel } from "@/app/slide-out-panel";
import type { OrganizationMember, WorkspaceSummary } from "@/lib/domains/members/service";

import { ORG_ROLES, roleDefinition } from "@/lib/rbac";
import { AdminMutationStatus } from "../mutation-status";
import { formatAdminDate } from "../format";
import {
  removeOrganizationMember,
  revokeMemberInvite,
  updateMemberOrgRoleForm,
  updateWorkspaceOverride,
} from "./member-actions";

interface MemberInspectorProps {
  member: OrganizationMember;
  workspaces: WorkspaceSummary[];
  isCurrentUser: boolean;
}

function ApplyRoleButton() {
  const t = useTranslations("admin.members.inspector");
  const { pending } = useFormStatus();
  return (
    <button className="button buttonPrimary" type="submit" disabled={pending}>
      {pending ? t("applying") : t("apply_role")}
    </button>
  );
}

function SaveOverrideButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("admin.members.inspector");
  const { pending } = useFormStatus();
  return (
    <button className="button buttonPrimary" type="submit" disabled={disabled || pending}>
      {pending ? t("saving") : t("save_override")}
    </button>
  );
}

function LifecycleSubmitButton({
  pendingLabel,
  completed,
  completedLabel,
  children,
}: {
  pendingLabel: string;
  completed: boolean;
  completedLabel: string;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button className="button buttonDanger" type="submit" disabled={pending || completed}>
      {completed ? completedLabel : pending ? pendingLabel : children}
    </button>
  );
}

function OrgRoleForm({ member }: { member: OrganizationMember }) {
  const t = useTranslations("admin.members.inspector");
  const [state, action] = useActionState(updateMemberOrgRoleForm, null);

  return (
    <form action={action} className="adminMembersInspectorForm">
      <input type="hidden" name="principalId" value={member.id} />
      <label className="field">
        <span>{t("role")}</span>
        <select className="input" name="orgRole" defaultValue={member.orgRole}>
          {ORG_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleDefinition(role).label}
            </option>
          ))}
        </select>
      </label>
      <ApplyRoleButton />
      {state?.message ? (
        <p className="meta" style={{ color: "var(--allow)" }}>
          {state.message}
        </p>
      ) : null}
      {state?.error ? <p className="meta publishError">{state.error}</p> : null}
    </form>
  );
}

function WorkspaceOverrideForm({
  member,
  workspaces,
}: {
  member: OrganizationMember;
  workspaces: WorkspaceSummary[];
}) {
  const t = useTranslations("admin.members.inspector");
  const [state, action] = useActionState(updateWorkspaceOverride, null);

  return (
    <form action={action} className="adminMembersInspectorForm">
      <input type="hidden" name="principalId" value={member.id} />
      <div className="adminAuthTwoColumn">
        <label className="field">
          <span>{t("workspace")}</span>
          <select
            className="input"
            name="workspaceId"
            defaultValue={workspaces[0]?.id ?? ""}
            disabled={!workspaces.length}
          >
            {workspaces.length ? (
              workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))
            ) : (
              <option value="">{t("no_workspaces")}</option>
            )}
          </select>
        </label>
        <label className="field">
          <span>{t("override_role")}</span>
          <select
            className="input"
            name="workspaceRole"
            defaultValue="INHERIT"
            disabled={!workspaces.length}
          >
            <option value="INHERIT">{t("inherit_org_role")}</option>
            {ORG_ROLES.map((role) => (
              <option key={role} value={role}>
                {t("override_option", { role: roleDefinition(role).label })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SaveOverrideButton disabled={!workspaces.length} />
      <AdminMutationStatus error={state?.error} message={state?.message} />
    </form>
  );
}

function RevokeInviteForm({ member }: { member: OrganizationMember }) {
  const t = useTranslations("admin.members.inspector");
  const [state, action] = useActionState(revokeMemberInvite, null);
  const revoked = Boolean(state?.ok);

  return (
    <form
      action={action}
      className="adminMutationForm"
      onSubmit={(e) => {
        if (!window.confirm(t("confirm_revoke_invite", { name: member.displayName }))) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="principalId" value={member.id} />
      <LifecycleSubmitButton
        pendingLabel={t("revoking")}
        completed={revoked}
        completedLabel={t("invite_revoked")}
      >
        {t("revoke_invite")}
      </LifecycleSubmitButton>
      <AdminMutationStatus error={state?.error} message={state?.message} />
    </form>
  );
}

function RemoveMemberForm({ member }: { member: OrganizationMember }) {
  const t = useTranslations("admin.members.inspector");
  const [state, action] = useActionState(removeOrganizationMember, null);
  const removed = Boolean(state?.ok);

  return (
    <form
      action={action}
      className="adminMutationForm"
      onSubmit={(e) => {
        if (!window.confirm(t("confirm_remove_member", { name: member.displayName }))) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="principalId" value={member.id} />
      <LifecycleSubmitButton
        pendingLabel={t("removing")}
        completed={removed}
        completedLabel={t("member_removed")}
      >
        {t("remove_member")}
      </LifecycleSubmitButton>
      <AdminMutationStatus error={state?.error} message={state?.message} />
    </form>
  );
}

export function MemberInspector({ member, workspaces, isCurrentUser }: MemberInspectorProps) {
  const t = useTranslations("admin.members.inspector");
  const tenantGrant = member.grants.find((grant) => grant.workspaceId === null);
  const workspaceOverrides = member.grants.filter((grant) => grant.workspaceId !== null);

  return (
    <SlideOutPanel
      title={member.displayName}
      eyebrow={t("panel_eyebrow")}
      description={member.email ?? member.subject}
      width="wide"
      trigger={({ open, triggerId }) => (
        <button className="button buttonSmall" id={triggerId} onClick={open} type="button">
          {t("inspect")}
        </button>
      )}
    >
      <section className="adminMembersInspectorSection" aria-label={t("summary_aria_label")}>
        <div className="adminMembersInspectorGrid">
          <div>
            <p className="eyebrow">{t("status")}</p>
            <span
              className={member.inviteStatus === "ACCEPTED" ? "pill pillAllow" : "pill pillWarn"}
            >
              {member.inviteStatus === "ACCEPTED" ? t("active") : t("pending")}
            </span>
          </div>
          <div>
            <p className="eyebrow">{t("last_active")}</p>
            <strong>{formatAdminDate(member.lastActiveAt)}</strong>
          </div>
          <div>
            <p className="eyebrow">MFA</p>
            <span className={member.mfaEnrolled ? "pill pillAllow" : "pill pillNeutral"}>
              {member.mfaEnrolled ? t("mfa_enrolled") : t("mfa_not_enrolled")}
            </span>
          </div>
          <div>
            <p className="eyebrow">{t("passkeys")}</p>
            <strong>{member.passkeyCount}</strong>
          </div>
        </div>
        <code>{member.id}</code>
      </section>

      <section className="adminMembersInspectorSection" aria-labelledby={`${member.id}-org-role`}>
        <div className="adminMembersInspectorHeader">
          <div>
            <p className="eyebrow">{t("tenant_access")}</p>
            <h3 id={`${member.id}-org-role`}>{t("organization_role")}</h3>
          </div>
          <span className="pill pillNeutral">{roleDefinition(member.orgRole).label}</span>
        </div>
        <OrgRoleForm member={member} />
        <p className="meta">
          {tenantGrant?.reviewerRoles.length
            ? t("reviewer_lanes", { lanes: tenantGrant.reviewerRoles.join(", ") })
            : t("no_reviewer_lanes_tenant")}
        </p>
      </section>

      <section
        className="adminMembersInspectorSection"
        aria-labelledby={`${member.id}-workspace-role`}
      >
        <div className="adminMembersInspectorHeader">
          <div>
            <p className="eyebrow">{t("workspace_access")}</p>
            <h3 id={`${member.id}-workspace-role`}>{t("overrides")}</h3>
          </div>
          <span className="pill pillNeutral">{workspaceOverrides.length}</span>
        </div>
        <WorkspaceOverrideForm member={member} workspaces={workspaces} />
        <div className="adminMembersInspectorList">
          {workspaceOverrides.length ? (
            workspaceOverrides.map((grant) => (
              <div className="adminMembersInspectorItem" key={grant.id}>
                <div>
                  <strong>{grant.workspaceName ?? grant.workspaceSlug}</strong>
                  <p className="meta">{grant.workspaceSlug ?? t("workspace_override")}</p>
                </div>
                <span className="pill pillNeutral">{roleDefinition(grant.role).label}</span>
              </div>
            ))
          ) : (
            <p className="meta">{t("all_workspaces_inherit")}</p>
          )}
        </div>
      </section>

      <section
        className="adminMembersInspectorSection"
        aria-labelledby={`${member.id}-danger-zone`}
      >
        <div className="adminMembersInspectorHeader">
          <div>
            <p className="eyebrow">{t("lifecycle")}</p>
            <h3 id={`${member.id}-danger-zone`}>{t("member_actions")}</h3>
          </div>
          {isCurrentUser ? <span className="pill pillNeutral">{t("current_user")}</span> : null}
        </div>
        <div className="adminMembersInspectorActions">
          {member.inviteStatus === "PENDING" ? <RevokeInviteForm member={member} /> : null}
          {!isCurrentUser ? (
            <RemoveMemberForm member={member} />
          ) : (
            <p className="meta">{t("cannot_remove_self")}</p>
          )}
        </div>
      </section>
    </SlideOutPanel>
  );
}
