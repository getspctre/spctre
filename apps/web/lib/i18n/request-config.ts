import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getAuthSession } from "@/lib/auth-session";
import { getWorkspaceContext } from "@/lib/workspace";
import { createTenantTerminologyStore } from "@/lib/repositories/i18n/terminology";
import { getTenantTerminologyOverrides } from "./terminology";
import {
  LOCALE_COOKIE,
  applyMessageOverrides,
  getStaticMessages,
  resolveLocalePreference,
  type MessageCatalog,
  type SupportedLocale,
} from "./messages";
import { swallow } from "@/lib/platform/swallow";

export interface I18nRequestConfig {
  locale: SupportedLocale;
  messages: MessageCatalog;
  overrides: Record<string, string>;
  tenantId?: string;
}

export const resolveI18nRequestConfig = cache(async (): Promise<I18nRequestConfig> => {
  const headersList = await headers();
  const cookieStore = await cookies();
  const requestedLocale = {
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headersList.get("accept-language"),
  };

  if (headersList.get("x-is-docs") === "true") {
    return { locale: "en", messages: getStaticMessages("en"), overrides: {} };
  }

  let locale = resolveLocalePreference(requestedLocale);
  let tenantId: string | undefined;
  let overrides: Record<string, string> = {};

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  const hasAppAccess = Boolean(session && (!session.requireMfa || session.mfaVerified));

  if (hasAppAccess) {
    const workspaceContext = await getWorkspaceContext().catch(
      swallow("getWorkspaceContext", null),
    );
    if (workspaceContext) {
      tenantId = workspaceContext.tenantId;
      locale = resolveLocalePreference({
        profileLocale: workspaceContext.principalPreferredLocale,
        tenantLocale: workspaceContext.tenantDefaultLocale,
        ...requestedLocale,
      });
      overrides = await getTenantTerminologyOverrides(
        createTenantTerminologyStore(),
        workspaceContext.tenantId,
        locale,
      ).catch(swallow("getTenantTerminologyOverrides", {}));
    }
  }

  return {
    locale,
    tenantId,
    overrides,
    messages: applyMessageOverrides(getStaticMessages(locale), overrides),
  };
});
