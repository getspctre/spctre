import { createTtlCache } from "@/lib/platform/ttl-cache";
import {
  flattenMessages,
  getStaticMessages,
  normalizeLocale,
  type SupportedLocale,
} from "./messages";

export interface TenantTerminologyOverride {
  tenantId: string;
  locale: SupportedLocale;
  translationKey: string;
  customValue: string;
  updatedAt: string;
}

export interface TenantTerminologyStore {
  listOverrides(tenantId: string, locale: SupportedLocale): Promise<TenantTerminologyOverride[]>;
  upsertOverride?(override: TenantTerminologyOverride): Promise<void>;
  deleteOverride?(tenantId: string, locale: SupportedLocale, translationKey: string): Promise<void>;
}

// Cache holds only the tenant override entries (translationKey → customValue),
// not the full merged catalog. Keeping it override-only keeps entries small and
// lets the shell ship just the overrides to the client, where they layer on top
// of the statically-bundled base catalog via formatMessage.
const cache = createTtlCache<Record<string, string>>({ ttlMs: 5 * 60 * 1000, maxEntries: 1000 });

function cacheKey(tenantId: string, locale: SupportedLocale): string {
  return `${tenantId}:${locale}`;
}

async function loadOverrides(
  store: TenantTerminologyStore,
  tenantId: string,
  locale: SupportedLocale,
): Promise<Record<string, string>> {
  return cache.get(cacheKey(tenantId, locale), async () => {
    const overrides = await store.listOverrides(tenantId, locale);
    return overrides.reduce<Record<string, string>>((merged, override) => {
      merged[override.translationKey] = override.customValue;
      return merged;
    }, {});
  });
}

/**
 * Returns only the tenant's terminology overrides for a locale as a flat
 * `translationKey → customValue` record. This is the minimal payload handed to
 * the client shell (Sidebar/TopNav), which merges it over the bundled base
 * catalog. Result is cached per (tenant, locale) and invalidated on write.
 */
export async function getTenantTerminologyOverrides(
  store: TenantTerminologyStore,
  tenantId: string,
  localeInput: string | null | undefined,
): Promise<Record<string, string>> {
  return loadOverrides(store, tenantId, normalizeLocale(localeInput));
}

/**
 * Returns the full merged message map (bundled base catalog with tenant
 * overrides layered on top) for server-side rendering that needs every key.
 */
export async function getTenantMessages(
  store: TenantTerminologyStore,
  tenantId: string,
  localeInput: string | null | undefined,
): Promise<Record<string, string>> {
  const locale = normalizeLocale(localeInput);
  const base = flattenMessages(getStaticMessages(locale));
  const overrides = await loadOverrides(store, tenantId, locale);
  return { ...base, ...overrides };
}

function invalidateTenantMessages(tenantId: string, localeInput: string | null | undefined): void {
  cache.invalidate(cacheKey(tenantId, normalizeLocale(localeInput)));
}

export async function upsertTenantTerminologyOverride(
  store: TenantTerminologyStore,
  override: TenantTerminologyOverride,
): Promise<void> {
  if (!store.upsertOverride) {
    throw new Error("Tenant terminology store does not support writes.");
  }
  await store.upsertOverride(override);
  invalidateTenantMessages(override.tenantId, override.locale);
}

export async function deleteTenantTerminologyOverride(
  store: TenantTerminologyStore,
  tenantId: string,
  localeInput: string | null | undefined,
  translationKey: string,
): Promise<void> {
  if (!store.deleteOverride) {
    throw new Error("Tenant terminology store does not support deletes.");
  }
  const locale = normalizeLocale(localeInput);
  await store.deleteOverride(tenantId, locale, translationKey);
  invalidateTenantMessages(tenantId, locale);
}
