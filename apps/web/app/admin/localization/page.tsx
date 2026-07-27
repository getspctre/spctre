import { getTranslations } from "next-intl/server";
import { getActiveScope } from "@/lib/workspace";
import {
  flattenMessages,
  getStaticMessages,
  localeLabels,
  normalizeLocale,
  supportedLocales,
} from "@/lib/i18n/messages";
import { SettingsHeader } from "@/components/settings-header";
import { createTenantTerminologyStore } from "@/lib/repositories/i18n/terminology";
import { TerminologyOverrideInput, TerminologyResetButton } from "./terminology-row-controls";
import { sourceTermForLocale, terminologyOptions } from "./terminology-options";

export const dynamic = "force-dynamic";

function statusMessage(
  t: Awaited<ReturnType<typeof getTranslations>>,
  code: string | null,
  params: Record<string, string | string[] | undefined>
): string | null {
  if (!code) return null;
  const key = typeof params.key === "string" ? params.key : "";
  switch (code) {
    case "saved":
      return t("status.saved", { key });
    case "removed":
      return t("status.removed", { key });
    case "admin_required":
      return t("status.admin_required");
    case "unsupported_language":
      return t("status.unsupported_language");
    case "missing_fields":
      return t("status.missing_fields");
    case "missing_key":
      return t("status.missing_key");
    case "storage_unavailable":
      return t("status.storage_unavailable");
    case "unknown_key":
      return t("status.unknown_key", { key });
    default:
      return null;
  }
}

function customTermValue(
  option: (typeof terminologyOptions)[number],
  locale: typeof supportedLocales[number],
  baseMessages: Record<string, string>,
  overrides: Map<string, string>
): string | undefined {
  const sourceTerm = sourceTermForLocale(option, locale);
  for (const key of option.keys) {
    const standardValue = baseMessages[key];
    const customValue = overrides.get(key);
    if (!standardValue || !customValue) continue;
    const index = standardValue.toLocaleLowerCase().indexOf(sourceTerm.toLocaleLowerCase());
    if (index < 0) continue;
    const prefix = standardValue.slice(0, index);
    const suffix = standardValue.slice(index + sourceTerm.length);
    if (customValue.startsWith(prefix) && customValue.endsWith(suffix)) {
      return customValue.slice(prefix.length, customValue.length - suffix.length);
    }
  }
  return undefined;
}

export default async function AdminLocalizationPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.localization");
  const params = searchParams ? await searchParams : {};
  const localeParam = typeof params.locale === "string" ? params.locale : "en";
  const locale = normalizeLocale(localeParam);
  const { tenantId } = await getActiveScope();
  const overrides = await createTenantTerminologyStore().listOverrides(tenantId, locale).catch(() => []);
  const baseMessages = flattenMessages(getStaticMessages(locale));
  const overrideValues = new Map(overrides.map((override) => [override.translationKey, override.customValue]));

  const message =
    statusMessage(t, typeof params.okCode === "string" ? params.okCode : null, params) ??
    (typeof params.ok === "string" ? params.ok : null);
  const error =
    statusMessage(t, typeof params.errorCode === "string" ? params.errorCode : null, params) ??
    (typeof params.error === "string" ? params.error : null);

  return (
    <>
      <SettingsHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
      />

      <section className="adminAuthStack" aria-label={t("aria_label")}>
        <section className="panel adminWorkspacePanelCompact">
          <div>
            <p className="eyebrow">{t("language.eyebrow")}</p>
            <h2>{t("language.title")}</h2>
            <p className="meta">
              {t("language.description")}
            </p>
          </div>
          <form method="get" className="adminWorkspaceForm adminInlineSelectActionForm">
            <label>
              <span>{t("language.field")}</span>
              <select className="input" name="locale" defaultValue={locale}>
                {supportedLocales.map((option) => (
                  <option key={option} value={option}>
                    {localeLabels[option]} ({option.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">
              {t("language.submit")}
            </button>
          </form>
          {message ? <p className="meta">{message}</p> : null}
          {error ? <p className="meta workspaceError">{error}</p> : null}
        </section>

        <section className="panel">
          <div>
            <p className="eyebrow">Terminology</p>
            <h2>Use the terms your team already uses</h2>
            <p className="meta">Change the common labels shown across the selected language, without editing translation keys.</p>
          </div>
          <div className="auditTableWrapper">
            <table className="auditTable">
              <thead>
                <tr>
                  <th>Source term</th>
                  <th>Override</th>
                  <th>Reset</th>
                </tr>
              </thead>
              <tbody>
                {terminologyOptions.map((option) => (
                  <tr key={option.id}>
                    <td>
                      <strong>{option.label}</strong>
                      <p className="meta">{option.description}</p>
                    </td>
                    <td>
                      <TerminologyOverrideInput
                        initialValue={customTermValue(option, locale, baseMessages, overrideValues)}
                        label={option.label}
                        locale={locale}
                        placeholder={option.id === "organization" ? "Company" : "Team"}
                        term={option.id}
                      />
                    </td>
                    <td>
                      <TerminologyResetButton label={option.label} locale={locale} term={option.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </>
  );
}
