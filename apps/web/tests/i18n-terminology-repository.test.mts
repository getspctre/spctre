import { beforeEach, describe, expect, it, vi } from "vitest";

let tablePresent = true;

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
  const query = Array.from(strings).join(" ");

  if (query.includes("information_schema.tables")) {
    return [{ present: tablePresent }];
  }
  if (query.includes("SELECT translation_key")) {
    return [
      {
        translation_key: "common.workspace",
        custom_value: "Division",
        updated_at: new Date("2026-07-09T00:00:00.000Z"),
      },
    ];
  }
  if (query.includes("INSERT INTO tenant_terminology_override")) return [];
  if (query.includes("DELETE FROM tenant_terminology_override")) return [];

  throw new Error(`unexpected query: ${query} args=${JSON.stringify(args)}`);
});

vi.mock("@/lib/db", () => ({ sql: sqlMock }));

const { createTenantTerminologyStore, resetTenantTerminologyTableCacheForTests } =
  await import("@/lib/repositories/i18n/terminology");

describe("tenant terminology repository", () => {
  beforeEach(() => {
    sqlMock.mockClear();
    tablePresent = true;
    resetTenantTerminologyTableCacheForTests();
  });

  it("lists overrides only after detecting the table", async () => {
    const store = createTenantTerminologyStore();
    const overrides = await store.listOverrides("tenant-1", "ja");

    expect(overrides).toEqual([
      {
        tenantId: "tenant-1",
        locale: "ja",
        translationKey: "common.workspace",
        customValue: "Division",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);
    const selectCall = sqlMock.mock.calls.find((call) =>
      Array.from(call[0] as TemplateStringsArray)
        .join(" ")
        .includes("SELECT translation_key"),
    );
    expect(selectCall?.slice(1)).toEqual(["tenant-1", "ja"]);
  });

  it("upserts an override with bound parameters", async () => {
    const store = createTenantTerminologyStore();
    await store.upsertOverride!({
      tenantId: "tenant-1",
      locale: "de",
      translationKey: "common.connector",
      customValue: "Integration",
      updatedAt: "ignored",
    });

    const insertCall = sqlMock.mock.calls.find((call) =>
      Array.from(call[0] as TemplateStringsArray)
        .join(" ")
        .includes("INSERT INTO tenant_terminology_override"),
    );
    expect(insertCall?.slice(1)).toEqual(["tenant-1", "de", "common.connector", "Integration"]);
  });

  it("deletes an override with bound parameters", async () => {
    const store = createTenantTerminologyStore();
    await store.deleteOverride!("tenant-1", "fr", "common.save");

    const deleteCall = sqlMock.mock.calls.find((call) =>
      Array.from(call[0] as TemplateStringsArray)
        .join(" ")
        .includes("DELETE FROM tenant_terminology_override"),
    );
    expect(deleteCall?.slice(1)).toEqual(["tenant-1", "fr", "common.save"]);
  });

  it("returns no overrides on databases predating migration 075", async () => {
    tablePresent = false;
    const store = createTenantTerminologyStore();
    expect(await store.listOverrides("tenant-1", "ja")).toEqual([]);
  });

  it("refuses to persist when the table is absent", async () => {
    tablePresent = false;
    const store = createTenantTerminologyStore();
    await expect(
      store.upsertOverride!({
        tenantId: "tenant-1",
        locale: "de",
        translationKey: "common.connector",
        customValue: "Integration",
        updatedAt: "ignored",
      }),
    ).rejects.toThrow(/migration 075/);
  });
});
