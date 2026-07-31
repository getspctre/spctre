"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import { LOCALE_COOKIE, isSupportedLocaleInput, normalizeLocale } from "@/lib/i18n/messages";
import { setPrincipalPreferredLocale } from "@/lib/repositories/i18n/preferences";
import { swallow } from "@/lib/platform/swallow";

export async function setLocalePreference(localeInput: string): Promise<void> {
  if (!isSupportedLocaleInput(localeInput)) return;

  const locale = normalizeLocale(localeInput);
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (session) {
    await setPrincipalPreferredLocale({
      tenantId: session.tenantId,
      principalId: session.principalId,
      locale,
    }).catch(swallow("setPrincipalPreferredLocale", undefined));
  }

  revalidatePath("/");
  revalidatePath("/account");
}
