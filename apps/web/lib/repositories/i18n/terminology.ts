import { sql } from "@/lib/db";
import type { SupportedLocale } from "@/lib/i18n/messages";
import type { TenantTerminologyOverride, TenantTerminologyStore } from "@/lib/i18n/terminology";

// Database-backed implementation of the TenantTerminologyStore boundary defined
// in lib/i18n/terminology.ts. Reads/writes `tenant_terminology_override`
// (migration 075). Row-Level Security scopes rows to the current tenant context,
// so callers must run within runWithTenantContext; queries also filter by
// tenant_id explicitly for clarity and defense in depth.
//
// The table is detected once and cached: older databases that predate migration
// 075 return no overrides rather than failing request rendering, matching the
// defensive posture of the locale-preference repository.

let tableExistsCache: boolean | null = null;

async function detectTable(): Promise<boolean> {
  if (tableExistsCache !== null) return tableExistsCache;
  if (!sql) {
    tableExistsCache = false;
    return false;
  }
  const rows = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'tenant_terminology_override'
    ) AS present
  `;
  tableExistsCache = rows[0]?.present ?? false;
  return tableExistsCache;
}

export function resetTenantTerminologyTableCacheForTests(): void {
  tableExistsCache = null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function createTenantTerminologyStore(): TenantTerminologyStore {
  return {
    async listOverrides(tenantId: string, locale: SupportedLocale): Promise<TenantTerminologyOverride[]> {
      if (!sql) return [];
      if (!(await detectTable())) return [];

      const rows = await sql<{ translation_key: string; custom_value: string; updated_at: unknown }[]>`
        SELECT translation_key, custom_value, updated_at
        FROM tenant_terminology_override
        WHERE tenant_id = ${tenantId}
          AND locale = ${locale}
      `;

      return rows.map((row) => ({
        tenantId,
        locale,
        translationKey: row.translation_key,
        customValue: row.custom_value,
        updatedAt: toIso(row.updated_at),
      }));
    },

    async upsertOverride(override: TenantTerminologyOverride): Promise<void> {
      if (!sql) throw new Error("Database unavailable; cannot persist terminology override.");
      if (!(await detectTable())) {
        throw new Error("tenant_terminology_override table is not present; apply migration 075.");
      }

      await sql`
        INSERT INTO tenant_terminology_override (tenant_id, locale, translation_key, custom_value, updated_at)
        VALUES (${override.tenantId}, ${override.locale}, ${override.translationKey}, ${override.customValue}, now())
        ON CONFLICT (tenant_id, locale, translation_key)
        DO UPDATE SET custom_value = EXCLUDED.custom_value, updated_at = now()
      `;
    },

    async deleteOverride(tenantId: string, locale: SupportedLocale, translationKey: string): Promise<void> {
      if (!sql) throw new Error("Database unavailable; cannot delete terminology override.");
      if (!(await detectTable())) return;

      await sql`
        DELETE FROM tenant_terminology_override
        WHERE tenant_id = ${tenantId}
          AND locale = ${locale}
          AND translation_key = ${translationKey}
      `;
    },
  };
}
