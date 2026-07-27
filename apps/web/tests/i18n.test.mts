import { describe, expect, it, vi } from "vitest";
import {
  applyMessageOverrides,
  extractMessageKeys,
  formatMessage,
  getStaticMessages,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  resolveLocalePreference,
  supportedLocales,
  validateMessageCatalogs,
} from "@/lib/i18n/messages";
import {
  deleteTenantTerminologyOverride,
  getTenantMessages,
  getTenantTerminologyOverrides,
  upsertTenantTerminologyOverride,
  type TenantTerminologyOverride,
  type TenantTerminologyStore,
} from "@/lib/i18n/terminology";

function createStore(initial: TenantTerminologyOverride[] = []): TenantTerminologyStore {
  const rows = [...initial];
  return {
    listOverrides: vi.fn(async (tenantId, locale) =>
      rows.filter((row) => row.tenantId === tenantId && row.locale === locale)
    ),
    upsertOverride: vi.fn(async (override) => {
      const index = rows.findIndex(
        (row) =>
          row.tenantId === override.tenantId &&
          row.locale === override.locale &&
          row.translationKey === override.translationKey
      );
      if (index >= 0) rows[index] = override;
      else rows.push(override);
    }),
    deleteOverride: vi.fn(async (tenantId, locale, translationKey) => {
      const index = rows.findIndex(
        (row) => row.tenantId === tenantId && row.locale === locale && row.translationKey === translationKey
      );
      if (index >= 0) rows.splice(index, 1);
    }),
  };
}

describe("web i18n message catalogs", () => {
  it("normalizes browser and env locale variants to supported catalogs", () => {
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("de_DE.UTF-8")).toBe("de");
    expect(normalizeLocale("pt-BR")).toBe("en");
    expect(resolveLocalePreference({ profileLocale: "pt-BR", cookieLocale: "fr" })).toBe("fr");
    expect(resolveLocaleFromAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(resolveLocalePreference({ tenantLocale: "de", cookieLocale: "ja", acceptLanguage: "fr-CA,fr;q=0.9" })).toBe("de");
    expect(resolveLocalePreference({ profileLocale: "ja", tenantLocale: "de", cookieLocale: "fr" })).toBe("ja");
  });

  it("extracts typed message keys and formats placeholders", () => {
    expect(extractMessageKeys()).toContain("policies.workspace_policy");
    expect(formatMessage("en", "policies.meta_summary", { branchesCount: 2, rulesCount: 5 })).toBe(
      "2 branches · 5 active rules"
    );
  });

  it("applies flat tenant terminology overrides to nested next-intl messages", () => {
    const messages = applyMessageOverrides(getStaticMessages("en"), {
      "navigation.evidence": "Audit trail",
      "policies.workspace_policy": "Division policy",
    });

    expect((messages.navigation as Record<string, string>).evidence).toBe("Audit trail");
    expect((messages.policies as Record<string, string>).workspace_policy).toBe("Division policy");
    expect((getStaticMessages("en").navigation as Record<string, string>).evidence).toBe("Evidence");
  });

  it("keeps secondary locale catalogs aligned with the English extraction manifest", () => {
    const report = validateMessageCatalogs();
    for (const locale of supportedLocales) {
      expect(report[locale]).toEqual({ missing: [], extra: [] });
    }
  });
});

describe("tenant terminology overrides", () => {
  it("merges overrides into cached tenant messages", async () => {
    const store = createStore([
      {
        tenantId: "tenant-1",
        locale: "en",
        translationKey: "policies.workspace_policy",
        customValue: "Division policy",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);

    const messages = await getTenantMessages(store, "tenant-1", "en-US");
    expect(messages["policies.workspace_policy"]).toBe("Division policy");

    await getTenantMessages(store, "tenant-1", "en-US");
    expect(store.listOverrides).toHaveBeenCalledTimes(1);
  });

  it("returns only override entries (not the full catalog) for the shell payload", async () => {
    const store = createStore([
      {
        tenantId: "tenant-shell",
        locale: "en",
        translationKey: "navigation.evidence",
        customValue: "Audit trail",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);

    const overrides = await getTenantTerminologyOverrides(store, "tenant-shell", "en-US");
    expect(overrides).toEqual({ "navigation.evidence": "Audit trail" });

    // Cached per (tenant, locale): a second read does not re-query the store.
    await getTenantTerminologyOverrides(store, "tenant-shell", "en-US");
    expect(store.listOverrides).toHaveBeenCalledTimes(1);
  });

  it("shares its cache with getTenantMessages and reflects writes in both", async () => {
    const store = createStore();
    expect(await getTenantTerminologyOverrides(store, "tenant-shared", "de")).toEqual({});

    await upsertTenantTerminologyOverride(store, {
      tenantId: "tenant-shared",
      locale: "de",
      translationKey: "navigation.rules",
      customValue: "Richtlinien",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(await getTenantTerminologyOverrides(store, "tenant-shared", "de")).toEqual({
      "navigation.rules": "Richtlinien",
    });
    const merged = await getTenantMessages(store, "tenant-shared", "de");
    expect(merged["navigation.rules"]).toBe("Richtlinien");
  });

  it("invalidates tenant message cache after writes", async () => {
    const store = createStore();
    const initial = await getTenantMessages(store, "tenant-2", "en");
    expect(initial["navigation.evidence"]).toBe("Evidence");

    await upsertTenantTerminologyOverride(store, {
      tenantId: "tenant-2",
      locale: "en",
      translationKey: "navigation.evidence",
      customValue: "Audit trail",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });

    const updated = await getTenantMessages(store, "tenant-2", "en");
    expect(updated["navigation.evidence"]).toBe("Audit trail");
    expect(store.listOverrides).toHaveBeenCalledTimes(2);

    await deleteTenantTerminologyOverride(store, "tenant-2", "en", "navigation.evidence");
    const deleted = await getTenantMessages(store, "tenant-2", "en");
    expect(deleted["navigation.evidence"]).toBe("Evidence");
  });
});
