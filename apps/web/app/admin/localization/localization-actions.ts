"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "../admin-session";
import {
  deleteTenantTerminologyOverride,
  upsertTenantTerminologyOverride,
} from "@/lib/i18n/terminology";
import { createTenantTerminologyStore } from "@/lib/repositories/i18n/terminology";
import {
  flattenMessages,
  getStaticMessages,
  isSupportedLocaleInput,
  normalizeLocale,
} from "@/lib/i18n/messages";
import { getTerminologyOption, sourceTermForLocale } from "./terminology-options";

// Terminology overrides are surfaced through the root layout (Sidebar/TopNav),
// so a write must bust the layout everywhere, not just one route.
function revalidateShell() {
  revalidatePath("/", "layout");
}

export async function saveTerminologyTermInline(input: {
  locale: string;
  term: string;
  customTerm: string;
}): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: "Admin permission is required." };

  const localeInput = input.locale.trim();
  if (!isSupportedLocaleInput(localeInput)) return { error: "Unsupported language selection." };
  const locale = normalizeLocale(localeInput);
  const option = getTerminologyOption(input.term.trim());
  const customTerm = input.customTerm.trim();

  if (!option || !customTerm) return { error: "Enter an override before saving." };

  const messages = flattenMessages(getStaticMessages(locale));
  const sourceTerm = sourceTermForLocale(option, locale);
  const expression = new RegExp(sourceTerm, "gi");
  try {
    await Promise.all(
      option.keys.map(async (translationKey) => {
        const standardValue = messages[translationKey];
        if (!standardValue) return;
        await upsertTenantTerminologyOverride(createTenantTerminologyStore(), {
          tenantId: guard.session.tenantId,
          locale,
          translationKey,
          customValue: standardValue.replace(expression, customTerm),
          updatedAt: new Date().toISOString(),
        });
      }),
    );
  } catch {
    return { error: "Localization storage is not available on this database yet." };
  }

  revalidateShell();
  return {};
}

export async function resetTerminologyTermInline(input: {
  locale: string;
  term: string;
}): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: "Admin permission is required." };

  const localeInput = input.locale.trim();
  if (!isSupportedLocaleInput(localeInput)) return { error: "Unsupported language selection." };
  const locale = normalizeLocale(localeInput);
  const option = getTerminologyOption(input.term.trim());
  if (!option) return { error: "Unknown terminology term." };

  try {
    await Promise.all(
      option.keys.map((translationKey) =>
        deleteTenantTerminologyOverride(
          createTenantTerminologyStore(),
          guard.session.tenantId,
          locale,
          translationKey,
        ),
      ),
    );
  } catch {
    return { error: "Localization storage is not available on this database yet." };
  }
  revalidateShell();
  return {};
}
