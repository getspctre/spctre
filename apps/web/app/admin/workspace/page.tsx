import { getTranslations } from "next-intl/server";
import { getActiveScope } from "@/lib/workspace";
import { getAdminWorkspacePageModel } from "@/lib/domains/workspace/service";
import { getLocalePreferencesForShell } from "@/lib/repositories/i18n/preferences";
import { localeLabels, normalizeLocale, supportedLocales } from "@/lib/i18n/messages";
import { createWorkspaceAdmin, setTenantDefaultLocaleAdmin } from "./workspace-actions";
import { WorkspaceCard } from "./workspace-card";
import { SettingsHeader } from "@/components/settings-header";

export const dynamic = "force-dynamic";

function statusMessage(
  t: Awaited<ReturnType<typeof getTranslations>>,
  code: string | null,
  params: Record<string, string | string[] | undefined>,
): string | null {
  if (!code) return null;
  const slug = typeof params.slug === "string" ? params.slug : "";
  const locale = typeof params.locale === "string" ? params.locale : "";
  switch (code) {
    case "admin_required":
      return t("status.admin_required");
    case "created":
      return t("status.created", { slug });
    case "database_unconfigured":
      return t("status.database_unconfigured");
    case "deleted":
      return t("status.deleted", { slug });
    case "delete_confirm":
      return t("status.delete_confirm");
    case "locale_storage_unavailable":
      return t("status.locale_storage_unavailable");
    case "locale_updated":
      return t("status.locale_updated", { locale: locale.toUpperCase() });
    case "unsupported_language":
      return t("status.unsupported_language");
    case "updated":
      return t("status.updated", { slug });
    default:
      return null;
  }
}

export default async function AdminWorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.workspace");
  const params = searchParams ? await searchParams : {};
  const { workspaceContext, workspaces } = await getAdminWorkspacePageModel(await getActiveScope());

  const localePreferences = await getLocalePreferencesForShell({
    tenantId: workspaceContext.tenantId,
  });
  const defaultLocale = normalizeLocale(localePreferences.tenantDefaultLocale);

  const message =
    statusMessage(t, typeof params.okCode === "string" ? params.okCode : null, params) ??
    (typeof params.ok === "string" ? params.ok : null);
  const error =
    statusMessage(t, typeof params.errorCode === "string" ? params.errorCode : null, params) ??
    (typeof params.error === "string" ? params.error : null);

  return (
    <>
      <SettingsHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <section className="adminAuthStack" aria-label={t("aria_label")}>
        <section className="panel adminWorkspacePanelCompact">
          <div>
            <p className="eyebrow">{t("create.eyebrow")}</p>
            <h2>{t("create.title")}</h2>
          </div>
          <form action={createWorkspaceAdmin} className="adminWorkspaceForm">
            <label>
              <span>{t("create.name")}</span>
              <input
                className="input"
                name="workspaceName"
                required
                placeholder={t("create.name_placeholder")}
              />
            </label>
            <label>
              <span>{t("create.slug")}</span>
              <input
                className="input"
                name="workspaceSlug"
                placeholder={t("create.slug_placeholder")}
              />
            </label>
            <button className="button buttonPrimary" type="submit">
              {t("create.submit")}
            </button>
          </form>
          {message ? <p className="meta">{message}</p> : null}
          {error ? <p className="meta workspaceError">{error}</p> : null}
        </section>

        <section className="panel adminWorkspacePanelCompact">
          <div>
            <p className="eyebrow">{t("language.eyebrow")}</p>
            <h2>{t("language.title")}</h2>
            <p className="meta">{t("language.description")}</p>
          </div>
          <form
            action={setTenantDefaultLocaleAdmin}
            className="adminWorkspaceForm adminInlineSelectActionForm"
          >
            <label>
              <span>{t("language.field")}</span>
              <select className="input" name="locale" defaultValue={defaultLocale}>
                {supportedLocales.map((option) => (
                  <option key={option} value={option}>
                    {localeLabels[option]} ({option.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <button className="button buttonPrimary" type="submit">
              {t("language.submit")}
            </button>
          </form>
        </section>

        <section className="panel">
          <div>
            <p className="eyebrow">{t("manage.eyebrow")}</p>
            <h2>{t("manage.title")}</h2>
          </div>

          {workspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              id={workspace.id}
              slug={workspace.slug}
              name={workspace.name}
              createdAt={workspace.created_at.toLocaleString()}
              isActive={workspace.id === workspaceContext.workspaceId}
            />
          ))}
        </section>
      </section>
    </>
  );
}
