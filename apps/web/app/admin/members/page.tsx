import { ChevronDown, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SettingsHeader } from "@/components/settings-header";
import { getMembersPageModel } from "@/lib/domains/members/service";

import { ORG_ROLES, ROLE_DEFINITIONS, roleDefinition } from "@/lib/rbac";
import { PlanGate } from "@/app/plan-gate";
import { InviteMemberForm } from "./invite-member-form";
import { MemberInspector } from "./member-inspector";
import { formatAdminDate } from "../format";

export const dynamic = "force-dynamic";

function formatAction(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

type MembersPageModel = Awaited<ReturnType<typeof getMembersPageModel>>;
type Member = MembersPageModel["members"][number];
type AdminMembersT = Awaited<ReturnType<typeof getTranslations>>;

function getGranularGrantDimensions(t: AdminMembersT) {
  return [
    {
      label: t("granular.dimensions.reviewer_lanes.label"),
      value: t("granular.dimensions.reviewer_lanes.value"),
    },
    {
      label: t("granular.dimensions.publish_scopes.label"),
      value: t("granular.dimensions.publish_scopes.value"),
    },
    {
      label: t("granular.dimensions.environment_bounds.label"),
      value: t("granular.dimensions.environment_bounds.value"),
    },
  ];
}

function MemberRow({
  member,
  workspaces,
  isCurrentUser,
  t,
}: {
  member: Member;
  workspaces: MembersPageModel["workspaces"];
  isCurrentUser: boolean;
  t: AdminMembersT;
}) {
  const tenantGrant = member.grants.find((grant) => grant.workspaceId === null);
  const workspaceOverrides = member.grants.filter((grant) => grant.workspaceId !== null);
  return (
    <tr className="auditRow">
      <td>
        <div className="adminMembersIdentity">
          <div>
            <strong>{member.displayName}</strong>
            <span className="auditHash">{member.email ?? member.subject}</span>
          </div>
          <div className="adminMembersInlinePills">
            {isCurrentUser ? <span className="pill pillNeutral">{t("member_row.you")}</span> : null}
            <span className={member.inviteStatus === "ACCEPTED" ? "pill pillAllow" : "pill pillWarn"}>
              {member.inviteStatus === "ACCEPTED" ? t("member_row.active") : t("member_row.pending")}
            </span>
          </div>
          <code>{member.id}</code>
        </div>
      </td>
      <td>
        <strong>{roleDefinition(member.orgRole).label}</strong>
        <span className="auditHash">
          {tenantGrant?.reviewerRoles.length ? tenantGrant.reviewerRoles.join(", ") : t("member_row.no_reviewer_lanes")}
        </span>
      </td>
      <td>
        <div className="adminMembersState">
          <span className={member.mfaEnrolled ? "pill pillAllow" : "pill pillNeutral"}>
            {member.mfaEnrolled ? t("member_row.mfa_enrolled") : t("member_row.mfa_not_enrolled")}
          </span>
          <span className={member.passkeyCount > 0 ? "pill pillAllow" : "pill pillNeutral"}>
            {t("member_row.passkeys", { count: member.passkeyCount })}
          </span>
        </div>
        <span className="auditHash">{t("member_row.last_active", { date: formatAdminDate(member.lastActiveAt) })}</span>
      </td>
      <td>
        <div className="adminMembersOverrideList">
          {workspaceOverrides.length ? (
            workspaceOverrides.map((grant) => (
              <span className="pill pillNeutral" key={grant.id}>
                {grant.workspaceName ?? grant.workspaceSlug}: {roleDefinition(grant.role).label}
              </span>
            ))
          ) : (
            <span className="auditHash">{t("member_row.inherit_org_role")}</span>
          )}
        </div>
      </td>
      <td>
        <MemberInspector member={member} workspaces={workspaces} isCurrentUser={isCurrentUser} />
      </td>
    </tr>
  );
}

function RoleMatrix({ t }: { t: AdminMembersT }) {
  return (
    <details className="adminMembersRoleMatrix">
      <summary>
        <span>
          <span className="eyebrow">{t("role_matrix.eyebrow")}</span>
          <h2>{t("role_matrix.title")}</h2>
        </span>
        <ChevronDown size={18} aria-hidden className="matrixDisclosure" />
      </summary>
      <div className="auditTableWrapper">
        <table className="auditTable">
          <thead>
            <tr>
              <th>{t("role_matrix.role")}</th>
              <th>{t("role_matrix.reviewer_lanes")}</th>
              <th>{t("role_matrix.publish_scopes")}</th>
              <th>{t("role_matrix.capabilities")}</th>
            </tr>
          </thead>
          <tbody>
            {ORG_ROLES.map((role) => {
              const definition = ROLE_DEFINITIONS[role];
              return (
                <tr className="auditRow" key={role}>
                  <td>
                    <strong>{definition.label}</strong>
                    <span className="auditHash">{definition.summary}</span>
                  </td>
                  <td>
                    {definition.reviewerRoles.length ? definition.reviewerRoles.join(", ") : t("none")}
                  </td>
                  <td>
                    {definition.publishScopes.length ? definition.publishScopes.join(", ") : t("none")}
                  </td>
                  <td>{definition.capabilities.join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function GranularGrantsSection({ t }: { t: AdminMembersT }) {
  const dimensions = getGranularGrantDimensions(t);
  return (
    <PlanGate
      feature="enterpriseRbacAudit"
      fallback={
        <section className="adminAuthPanel adminMembersCustomRoles">
          <div className="adminAuthPanelHeader">
            <div>
              <p className="eyebrow">{t("granular.eyebrow")}</p>
              <h2>{t("granular.title")}</h2>
            </div>
            <span className="pill pillWarn">{t("enterprise")}</span>
          </div>
          <p className="meta">
            {t("granular.fallback_description")}
          </p>
          <div className="adminMembersGrantGrid">
            {dimensions.map((dimension) => (
              <div key={dimension.label}>
                <p className="eyebrow">{dimension.label}</p>
                <strong>{dimension.value}</strong>
              </div>
            ))}
          </div>
          <div className="adminAuthPanelActions">
            <a className="button" href="/usage-billing">{t("view_plans")}</a>
          </div>
        </section>
      }
    >
      <section className="adminAuthPanel">
        <div className="adminAuthPanelHeader">
          <div>
            <p className="eyebrow">{t("granular.eyebrow")}</p>
            <h2>{t("granular.title")}</h2>
          </div>
          <span className="pill pillAllow">{t("enterprise")}</span>
        </div>
        <p className="meta">
          {t("granular.description")}
        </p>
        <div className="adminMembersGrantGrid">
          {dimensions.map((dimension) => (
            <div key={dimension.label}>
              <p className="eyebrow">{dimension.label}</p>
              <strong>{dimension.value}</strong>
            </div>
          ))}
        </div>
        <div className="adminAuthPanelActions">
          <p className="meta">{t("granular.coming_soon")}</p>
        </div>
      </section>
    </PlanGate>
  );
}

function RbacAuditPanel({ auditEvents, t }: { auditEvents: MembersPageModel["auditEvents"]; t: AdminMembersT }) {
  return (
    <section className="adminAuthPanel">
      <div className="adminAuthPanelHeader">
        <div>
          <p className="eyebrow">{t("audit.eyebrow")}</p>
          <h2>{t("audit.title")}</h2>
        </div>
        <span className="pill pillNeutral">{auditEvents.length}</span>
      </div>
      <div className="adminAuthList">
        {auditEvents.length ? (
          auditEvents.map((event) => (
            <article className="adminAuthRecord" key={event.id}>
              <div className="rowHeader">
                <div>
                  <h3>{formatAction(event.action)}</h3>
                  <p className="meta">{formatAdminDate(event.createdAt)}</p>
                </div>
                <span className="pill pillNeutral">{t("audit.badge")}</span>
              </div>
              <code>{event.targetPrincipalId ?? t("audit.tenant")}</code>
            </article>
          ))
        ) : (
          <div className="adminAuthEmpty">
            <ShieldCheck size={18} aria-hidden />
            <div>
              <h3>{t("audit.empty_title")}</h3>
              <p className="meta">{t("audit.empty_description")}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default async function AdminMembersPage() {
  const t = await getTranslations("admin.members");
  const { workspaceContext, members, workspaces, auditEvents, session } = await getMembersPageModel();

  const pendingCount = members.filter((member) => member.inviteStatus === "PENDING").length;
  const activeCount = members.filter((member) => member.inviteStatus === "ACCEPTED").length;
  const adminCount = members.filter((member) => member.orgRole === "ADMIN").length;
  const secureCount = members.filter((member) => member.mfaEnrolled || member.passkeyCount > 0).length;

  return (
    <>
      <SettingsHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <span className="pill pillNeutral">{t("counts.seats", { count: members.length })}</span>
            <span className="pill pillAllow">{t("counts.active", { count: activeCount })}</span>
            <span className={pendingCount ? "pill pillWarn" : "pill pillNeutral"}>{t("counts.pending", { count: pendingCount })}</span>
          </>
        }
      />

      <div className="adminAuthLayout adminMembersLayout">
        <section className="adminAuthStack" aria-label={t("aria_label")}>
          <section className="adminMembersSummary" aria-label={t("summary.aria_label")}>
            <div>
              <p className="eyebrow">{t("summary.total_seats")}</p>
              <strong>{members.length}</strong>
              <span className="meta">{t("summary.provisioned_users")}</span>
            </div>
            <div>
              <p className="eyebrow">{t("summary.active")}</p>
              <strong>{activeCount}</strong>
              <span className="meta">{t("summary.pending_invites", { count: pendingCount })}</span>
            </div>
            <div>
              <p className="eyebrow">{t("summary.admins")}</p>
              <strong>{adminCount}</strong>
              <span className="meta">{t("summary.tenant_level_access")}</span>
            </div>
            <div>
              <p className="eyebrow">{t("summary.mfa_or_passkey")}</p>
              <strong>{secureCount}</strong>
              <span className="meta">{t("summary.stronger_auth")}</span>
            </div>
          </section>

          <section className="adminMembersPanel" aria-labelledby="members-heading">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">{t("table_section.eyebrow")}</p>
                <h2 id="members-heading">{t("table_section.title")}</h2>
              </div>
              <UsersRound size={18} aria-hidden />
            </div>

            <div className="auditTableWrapper adminMembersTableWrapper">
              <table className="auditTable adminMembersTable">
                <thead>
                  <tr>
                    <th>{t("table.member")}</th>
                    <th>{t("table.org_role")}</th>
                    <th>{t("table.access_state")}</th>
                    <th>{t("table.workspace_access")}</th>
                    <th>{t("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      workspaces={workspaces}
                      isCurrentUser={member.id === session.principalId}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <RoleMatrix t={t} />
        </section>

        <aside className="adminAuthSidebar adminMembersSidebar" aria-label={t("sidebar_aria_label")}>
          <div className="adminAuthSectionHeader">
            <UserPlus size={18} aria-hidden />
            <div>
              <p className="eyebrow">{t("invite_section.eyebrow")}</p>
              <h2>{t("invite_section.title")}</h2>
            </div>
          </div>
          <InviteMemberForm />

          <GranularGrantsSection t={t} />

          <RbacAuditPanel auditEvents={auditEvents} t={t} />
        </aside>
      </div>
    </>
  );
}
