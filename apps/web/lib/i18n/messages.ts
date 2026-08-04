import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import frMessages from "@/messages/fr.json";
import jaMessages from "@/messages/ja.json";

export const supportedLocales = ["en", "ja", "de", "fr"] as const;
export const LOCALE_COOKIE = "spctre_locale";
export type SupportedLocale = (typeof supportedLocales)[number];

/** Native-language display labels for each supported locale (for selectors). */
export const localeLabels: Record<SupportedLocale, string> = {
  en: "English",
  ja: "日本語",
  de: "Deutsch",
  fr: "Français",
};
type MessageValue = string | { [key: string]: MessageValue };
export type MessageCatalog = Record<string, MessageValue>;
export type MessageVariables = Record<string, string | number | boolean | null | undefined>;

const catalogs = {
  en: enMessages,
  ja: jaMessages,
  de: deMessages,
  fr: frMessages,
} satisfies Record<SupportedLocale, MessageCatalog>;

export function normalizeLocale(locale: string | null | undefined): SupportedLocale {
  if (!locale) return "en";
  const candidate = locale.replace("_", "-").split("-")[0]?.toLowerCase();
  return supportedLocales.includes(candidate as SupportedLocale)
    ? (candidate as SupportedLocale)
    : "en";
}

export function isSupportedLocaleInput(locale: string | null | undefined): boolean {
  if (!locale) return false;
  const candidate = locale.replace("_", "-").split("-")[0]?.toLowerCase();
  return supportedLocales.includes(candidate as SupportedLocale);
}

export function resolveLocaleFromAcceptLanguage(
  header: string | null | undefined,
): SupportedLocale {
  if (!header) return "en";

  for (const part of header.split(",")) {
    const locale = part.trim().split(";")[0];
    const normalized = normalizeLocale(locale);
    if (normalized !== "en" || locale?.toLowerCase().startsWith("en")) return normalized;
  }

  return "en";
}

export function resolveLocalePreference(input: {
  profileLocale?: string | null;
  tenantLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): SupportedLocale {
  if (input.profileLocale) {
    const normalized = normalizeLocale(input.profileLocale);
    if (normalized !== "en" || input.profileLocale.toLowerCase().startsWith("en"))
      return normalized;
  }

  if (input.tenantLocale) {
    const normalized = normalizeLocale(input.tenantLocale);
    if (normalized !== "en" || input.tenantLocale.toLowerCase().startsWith("en")) return normalized;
  }

  if (input.cookieLocale) {
    const normalized = normalizeLocale(input.cookieLocale);
    if (normalized !== "en" || input.cookieLocale.toLowerCase().startsWith("en")) return normalized;
  }

  return resolveLocaleFromAcceptLanguage(input.acceptLanguage);
}

export function getStaticMessages(locale: string | null | undefined): MessageCatalog {
  return catalogs[normalizeLocale(locale)];
}

export function applyMessageOverrides(
  messages: MessageCatalog,
  overrides: Record<string, string> = {},
): MessageCatalog {
  const merged: MessageCatalog = { ...messages };

  for (const [path, value] of Object.entries(overrides)) {
    const segments = path.split(".").filter(Boolean);
    if (!segments.length) continue;

    let target = merged;
    for (const segment of segments.slice(0, -1)) {
      const existing = target[segment];
      const next = typeof existing === "object" && existing !== null ? { ...existing } : {};
      target[segment] = next;
      target = next;
    }

    target[segments[segments.length - 1]!] = value;
  }

  return merged;
}

export function flattenMessages(messages: MessageCatalog, prefix = ""): Record<string, string> {
  const flattened: Record<string, string> = {};

  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      flattened[path] = value;
    } else {
      Object.assign(flattened, flattenMessages(value, path));
    }
  }

  return flattened;
}

export function extractMessageKeys(locale: string | null | undefined = "en"): string[] {
  return Object.keys(flattenMessages(getStaticMessages(locale))).sort();
}

export function validateMessageCatalogs(): Record<
  SupportedLocale,
  { missing: string[]; extra: string[] }
> {
  const referenceKeys = new Set(extractMessageKeys("en"));
  const report = {} as Record<SupportedLocale, { missing: string[]; extra: string[] }>;

  for (const locale of supportedLocales) {
    const keys = new Set(extractMessageKeys(locale));
    report[locale] = {
      missing: [...referenceKeys].filter((key) => !keys.has(key)).sort(),
      extra: [...keys].filter((key) => !referenceKeys.has(key)).sort(),
    };
  }

  return report;
}

export function formatMessage(
  locale: string | null | undefined,
  key: string,
  variables: MessageVariables = {},
  overrides: Record<string, string> = {},
): string {
  const messages = { ...flattenMessages(getStaticMessages(locale)), ...overrides };
  const template = messages[key] ?? flattenMessages(catalogs.en)[key] ?? key;

  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = variables[name];
    return value === null || value === undefined ? match : String(value);
  });
}
