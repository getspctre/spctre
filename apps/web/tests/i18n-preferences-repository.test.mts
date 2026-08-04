import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
  const query = Array.from(strings).join(" ");

  if (query.includes("information_schema.columns")) {
    return [
      { table_name: "app_principal", column_name: "preferred_locale" },
      { table_name: "tenant", column_name: "default_locale" },
    ];
  }

  if (query.includes("SELECT default_locale")) return [{ default_locale: "de" }];
  if (query.includes("SELECT preferred_locale")) return [{ preferred_locale: "ja" }];
  if (query.includes("UPDATE app_principal")) return [];
  if (query.includes("UPDATE tenant")) return [];

  throw new Error(`unexpected query: ${query} args=${JSON.stringify(args)}`);
});

vi.mock("@/lib/db", () => ({ sql: sqlMock }));

const preferences = await import("@/lib/repositories/i18n/preferences");

describe("i18n preference repository", () => {
  beforeEach(() => {
    sqlMock.mockClear();
    preferences.resetLocalePreferenceColumnCacheForTests();
  });

  it("reads shell preferences only after detecting locale columns", async () => {
    const result = await preferences.getLocalePreferencesForShell({
      tenantId: "tenant-1",
      principalId: "principal-1",
    });

    expect(result).toEqual({ tenantDefaultLocale: "de", principalPreferredLocale: "ja" });
  });

  it("persists principal preferred locale when the column is available", async () => {
    const result = await preferences.setPrincipalPreferredLocale({
      tenantId: "tenant-1",
      principalId: "principal-1",
      locale: "fr",
    });

    expect(result).toBe("updated");
  });

  it("persists tenant default locale when the column is available", async () => {
    const result = await preferences.setTenantDefaultLocale({ tenantId: "tenant-1", locale: "de" });

    expect(result).toBe("updated");
  });
});
