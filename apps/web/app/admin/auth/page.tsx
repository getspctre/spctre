import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { getAdminAuthPageModel } from "@/lib/domains/auth/service";
import { isScimProvisioningEntitled, listScimTokens } from "@/lib/domains/scim-token/service";

import { getActiveScope } from "@/lib/workspace";
import { IdpForm } from "./idp-form";
import { TenantMfaSettingsForm } from "./tenant-mfa-settings-form";
import { ScimTokenManager } from "./scim-token-manager";
import { PlanGate } from "@/app/plan-gate";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { RemoveIdpForm } from "./remove-idp-form";
import { SettingsHeader } from "@/components/settings-header";

export const dynamic = "force-dynamic";

export default async function AdminAuthPage() {
  const t = await getTranslations("admin.auth");
  const workspaceContext = await getActiveScope();
  const session = await getAuthSession().catch(() => null);
  if (!session) {
    redirect("/login");
  }

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspaceContext.workspaceId
  }).catch(() => null);
  if (!actor?.reviewerRoles.includes("Admin")) {
    redirect("/?error=admin-required");
  }

  const { providers, tenantMfa } = await getAdminAuthPageModel(session.tenantId);

  const scimEntitled = await isScimProvisioningEntitled(session.tenantId).catch(() => false);
  const scimTokens = scimEntitled
    ? await listScimTokens({ tenantId: session.tenantId }).catch(() => [])
    : [];
  const scimEndpoint = `${process.env.SPCTRE_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/scim/v2`;

  return (
    <>
      <SettingsHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        actions={
          <>
            <span className="pill pillNeutral">{t("provider_count", { count: providers.length })}</span>
            <span className={tenantMfa.requireMfa ? "pill pillAllow" : "pill pillWarn"}>
              {tenantMfa.requireMfa ? t("mfa_required") : t("mfa_optional")}
            </span>
          </>
        }
      />

      <div className="adminAuthLayout">
        <section className="adminAuthStack" aria-label={t("aria_label")}>
          <div className="adminAuthSectionHeader">
            <KeyRound size={18} aria-hidden />
            <div>
              <p className="eyebrow">{t("provider_section.eyebrow")}</p>
              <h2>{t("provider_section.title")}</h2>
            </div>
          </div>
          <IdpForm existing={providers[0]} />

          <div className="adminAuthSectionHeader">
            <ShieldCheck size={18} aria-hidden />
            <div>
              <p className="eyebrow">{t("access_section.eyebrow")}</p>
              <h2>{t("access_section.title")}</h2>
            </div>
          </div>
          <TenantMfaSettingsForm requireMfa={tenantMfa.requireMfa} mfaGraceDays={tenantMfa.mfaGraceDays} />

        </section>

        <aside className="adminAuthSidebar" aria-label={t("state_aria_label")}>
          <section className="adminAuthPanel">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">{t("providers.eyebrow")}</p>
                <h2>{t("providers.title")}</h2>
              </div>
              <span className="pill pillNeutral">{providers.length}</span>
            </div>
            <div className="adminAuthList">
              {providers.length ? (
                providers.map((provider) => (
                  <article className="adminAuthRecord" key={provider.id}>
                    <div className="rowHeader">
                      <div>
                        <h3>{provider.name}</h3>
                        <p className="meta">{provider.providerType}</p>
                      </div>
                      <span className="pill pillNeutral">{provider.providerType}</span>
                    </div>
                    <dl className="adminAuthDetails">
                      <div>
                        <dt>{t("providers.issuer")}</dt>
                        <dd>{provider.issuer}</dd>
                      </div>
                      <div>
                        <dt>{t("providers.client_id")}</dt>
                        <dd>{provider.clientId}</dd>
                      </div>
                    </dl>
                    <RemoveIdpForm providerId={provider.id} providerName={provider.name} />
                  </article>
                ))
              ) : (
                <div className="adminAuthEmpty">
                  <LockKeyhole size={18} aria-hidden />
                  <div>
                    <h3>{t("providers.empty_title")}</h3>
                    <p className="meta">{t("providers.empty_description")}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {scimEntitled ? (
            <section className="adminAuthPanel">
              <div className="adminAuthPanelHeader">
                <div>
                  <p className="eyebrow">{t("scim.eyebrow")}</p>
                  <h2>{t("scim.title")}</h2>
                </div>
                <span className="pill pillAllow">{t("scim.plan")}</span>
              </div>
              <p className="meta">
                {t("scim.description")}
              </p>
              <ScimTokenManager tokens={scimTokens} scimEndpoint={scimEndpoint} />
            </section>
          ) : (
            <PlanGate feature="samlScimProvisioning">
              <section className="adminAuthPanel">
                <div className="adminAuthPanelHeader">
                  <div>
                    <p className="eyebrow">{t("scim.eyebrow")}</p>
                    <h2>{t("scim.title")}</h2>
                  </div>
                  <span className="pill pillAllow">{t("scim.plan")}</span>
                </div>
                <p className="meta">
                  {t("scim.description")}
                </p>
              </section>
            </PlanGate>
          )}

        </aside>
      </div>
    </>
  );
}
