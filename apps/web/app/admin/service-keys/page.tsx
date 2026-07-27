import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { KeyRound } from "lucide-react";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { listWorkspaceApiKeys } from "@/lib/domains/identity/service";
import { isWorkspaceDatabaseConfigured } from "@/lib/domains/workspace/service";
import { SettingsHeader } from "@/components/settings-header";
import { getActiveScope } from "@/lib/workspace";
import { ADMIN_ISSUABLE_API_KEY_SCOPES } from "@/lib/service-tokens";
import { formatAdminDate } from "../format";
import { ServiceKeyForm } from "./service-key-form";
import { RevokeServiceKeyForm } from "./revoke-service-key-form";

export const dynamic = "force-dynamic";

export default async function AdminServiceKeysPage() {
  const t = await getTranslations("admin.service_keys");
  const workspaceContext = await getActiveScope();
  const session = await getAuthSession().catch(() => null);
  if (!session) redirect("/login");

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspaceContext.workspaceId,
  }).catch(() => null);
  if (!actor?.reviewerRoles.includes("Admin")) {
    redirect("/?error=admin-required");
  }

  const keys = isWorkspaceDatabaseConfigured()
    ? await listWorkspaceApiKeys({ tenantId: session.tenantId, workspaceId: workspaceContext.workspaceId })
    : [];

  return (
    <>
      <SettingsHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <span className="pill pillNeutral">{t("active_count", { count: keys.length })}</span>
        }
      />

      <div className="adminAuthLayout">
        <section className="adminAuthStack" aria-label={t("aria_label")}>
          <section className="adminAuthPanel" aria-labelledby="keys-heading">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">{t("active.eyebrow")}</p>
                <h2 id="keys-heading">{t("active.title")}</h2>
              </div>
              <KeyRound size={18} aria-hidden />
            </div>

            {keys.length ? (
              <div className="auditTableWrapper">
                <table className="auditTable">
                  <thead>
                    <tr>
                      <th>{t("table.label")}</th>
                      <th>{t("table.token_prefix")}</th>
                      <th>{t("table.scopes")}</th>
                      <th>{t("table.expires")}</th>
                      <th>{t("table.last_used")}</th>
                      <th>{t("table.created")}</th>
                      <th>{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr className="auditRow" key={key.id}>
                        <td>
                          <strong>{key.label}</strong>
                        </td>
                        <td>
                          <code>{key.token_prefix}…</code>
                        </td>
                        <td>
                          <div className="adminMembersInlinePills">
                            {key.scopes.map((scope) => (
                              <span key={scope} className="pill pillNeutral">{scope}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {key.expires_at
                            ? <span className={new Date(key.expires_at) < new Date() ? "pill pillWarn" : ""}>{formatAdminDate(key.expires_at)}</span>
                            : <span className="auditHash">{t("never")}</span>}
                        </td>
                        <td><span className="auditHash">{formatAdminDate(key.last_used_at)}</span></td>
                        <td><span className="auditHash">{formatAdminDate(key.created_at)}</span></td>
                        <td>
                          <RevokeServiceKeyForm keyId={key.id} label={key.label} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="adminAuthEmpty">
                <KeyRound size={18} aria-hidden />
                <div>
                  <h3>{t("empty.title")}</h3>
                  <p className="meta">{t("empty.description")}</p>
                </div>
              </div>
            )}
          </section>

          <section className="adminAuthPanel">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">{t("usage.eyebrow")}</p>
                <h2>{t("usage.title")}</h2>
              </div>
            </div>
            <p className="meta">{t("usage.description")}</p>
            <pre className="serviceKeyCodeSample">{t("usage.code_sample")}</pre>
          </section>
        </section>

        <aside className="adminAuthSidebar" aria-label={t("generate_aria_label")}>
          <div className="adminAuthSectionHeader">
            <KeyRound size={18} aria-hidden />
            <div>
              <p className="eyebrow">{t("new.eyebrow")}</p>
              <h2>{t("new.title")}</h2>
            </div>
          </div>
          <ServiceKeyForm availableScopes={ADMIN_ISSUABLE_API_KEY_SCOPES} />
        </aside>
      </div>
    </>
  );
}
