import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Webhook } from "lucide-react";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { isWorkspaceDatabaseConfigured } from "@/lib/domains/workspace/service";
import { getActiveScope } from "@/lib/workspace";
import { SettingsHeader } from "@/components/settings-header";
import {
  GATEWAY_WEBHOOK_PROVIDERS,
  listGatewayWebhookRegistrations,
} from "@/lib/domains/gateway-webhook/service";
import { formatAdminDate } from "../format";
import { WebhookForm } from "./webhook-form";
import { RevokeWebhookForm } from "./revoke-webhook-form";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS = new Map(GATEWAY_WEBHOOK_PROVIDERS.map((provider) => [provider.id, provider.label]));

export default async function AdminWebhooksPage() {
  const t = await getTranslations("admin.webhooks");
  const workspaceContext = await getActiveScope();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) redirect("/login");

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspaceContext.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) {
    redirect("/?error=admin-required");
  }

  const registrations = isWorkspaceDatabaseConfigured()
    ? await listGatewayWebhookRegistrations({
        tenantId: session.tenantId,
        workspaceId: workspaceContext.workspaceId,
      })
    : [];

  return (
    <>
      <SettingsHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <span className="pill pillNeutral">
            {t("active_count", { count: registrations.length })}
          </span>
        }
      />

      <div className="adminAuthLayout">
        <section className="adminAuthStack" aria-label={t("aria_label")}>
          <section className="adminAuthPanel" aria-labelledby="webhooks-heading">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">{t("active.eyebrow")}</p>
                <h2 id="webhooks-heading">{t("active.title")}</h2>
              </div>
              <Webhook size={18} aria-hidden />
            </div>

            {registrations.length ? (
              <div className="auditTableWrapper">
                <table className="auditTable">
                  <thead>
                    <tr>
                      <th>{t("table.provider")}</th>
                      <th>{t("table.label")}</th>
                      <th>{t("table.registration")}</th>
                      <th>{t("table.created_by")}</th>
                      <th>{t("table.created")}</th>
                      <th>{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registrations.map((registration) => (
                      <tr className="auditRow" key={registration.id}>
                        <td>
                          <span className="pill pillNeutral">
                            {PROVIDER_LABELS.get(registration.provider) ?? registration.provider}
                          </span>
                        </td>
                        <td>
                          {registration.label ? <strong>{registration.label}</strong> : <span className="auditHash">—</span>}
                        </td>
                        <td>
                          <code>{registration.id.slice(0, 8)}…</code>
                        </td>
                        <td><span className="auditHash">{registration.createdBy}</span></td>
                        <td><span className="auditHash">{formatAdminDate(registration.createdAt)}</span></td>
                        <td>
                          <RevokeWebhookForm
                            registrationId={registration.id}
                            label={registration.label ?? PROVIDER_LABELS.get(registration.provider) ?? registration.provider}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="adminAuthEmpty">
                <Webhook size={18} aria-hidden />
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
                <p className="eyebrow">{t("setup.eyebrow")}</p>
                <h2>{t("setup.title")}</h2>
              </div>
            </div>
            <p className="meta">
              {t("setup.description_prefix")}
              <code> x-spctre-gateway-secret</code>
              {t("setup.description_suffix")}
            </p>
            <pre className="serviceKeyCodeSample">{t("setup.code_sample")}</pre>
          </section>
        </section>

        <aside className="adminAuthSidebar" aria-label={t("generate_aria_label")}>
          <div className="adminAuthSectionHeader">
            <Webhook size={18} aria-hidden />
            <div>
              <p className="eyebrow">{t("new.eyebrow")}</p>
              <h2>{t("new.title")}</h2>
            </div>
          </div>
          <WebhookForm providers={GATEWAY_WEBHOOK_PROVIDERS.map((provider) => ({ ...provider }))} />
        </aside>
      </div>
    </>
  );
}
