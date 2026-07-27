import { sql } from "@/lib/db";

interface LocalePreferenceColumns {
  principalPreferredLocale: boolean;
  tenantDefaultLocale: boolean;
}

export interface LocalePreferences {
  principalPreferredLocale?: string | null;
  tenantDefaultLocale?: string | null;
}

let columnCache: LocalePreferenceColumns | null = null;

async function detectLocalePreferenceColumns(): Promise<LocalePreferenceColumns> {
  if (columnCache) return columnCache;
  if (!sql) {
    columnCache = { principalPreferredLocale: false, tenantDefaultLocale: false };
    return columnCache;
  }

  const rows = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'app_principal' AND column_name = 'preferred_locale')
        OR (table_name = 'tenant' AND column_name = 'default_locale')
      )
  `;

  columnCache = {
    principalPreferredLocale: rows.some(
      (row) => row.table_name === "app_principal" && row.column_name === "preferred_locale"
    ),
    tenantDefaultLocale: rows.some((row) => row.table_name === "tenant" && row.column_name === "default_locale"),
  };
  return columnCache;
}

export function resetLocalePreferenceColumnCacheForTests(): void {
  columnCache = null;
}

export async function getLocalePreferencesForShell(params: {
  tenantId: string;
  principalId?: string | null;
}): Promise<LocalePreferences> {
  if (!sql) return {};

  const columns = await detectLocalePreferenceColumns();
  const preferences: LocalePreferences = {};

  if (columns.tenantDefaultLocale) {
    const tenantRows = await sql<{ default_locale: string | null }[]>`
      SELECT default_locale
      FROM tenant
      WHERE id = ${params.tenantId}
      LIMIT 1
    `;
    preferences.tenantDefaultLocale = tenantRows[0]?.default_locale ?? null;
  }

  if (columns.principalPreferredLocale && params.principalId) {
    const principalRows = await sql<{ preferred_locale: string | null }[]>`
      SELECT preferred_locale
      FROM app_principal
      WHERE id = ${params.principalId}
        AND tenant_id = ${params.tenantId}
      LIMIT 1
    `;
    preferences.principalPreferredLocale = principalRows[0]?.preferred_locale ?? null;
  }

  return preferences;
}

export async function setPrincipalPreferredLocale(params: {
  tenantId: string;
  principalId: string;
  locale: string;
}): Promise<"updated" | "column-unavailable" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  const columns = await detectLocalePreferenceColumns();
  if (!columns.principalPreferredLocale) return "column-unavailable";

  await sql`
    UPDATE app_principal
    SET preferred_locale = ${params.locale}
    WHERE id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
  `;

  return "updated";
}

export async function setTenantDefaultLocale(params: {
  tenantId: string;
  locale: string;
}): Promise<"updated" | "column-unavailable" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  const columns = await detectLocalePreferenceColumns();
  if (!columns.tenantDefaultLocale) return "column-unavailable";

  await sql`
    UPDATE tenant
    SET default_locale = ${params.locale}
    WHERE id = ${params.tenantId}
  `;

  return "updated";
}
