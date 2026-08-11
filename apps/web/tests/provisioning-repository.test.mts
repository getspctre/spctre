import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000401";

let rawQueries: string[] = [];
let beginBehaviour: () => Promise<unknown> = async () => ({
  tenantId: TENANT_ID,
  workspaceId: "ws",
  principalId: "pr",
});

function rawSqlMock(strings: TemplateStringsArray, ..._values: unknown[]) {
  const query = strings.join("?");
  rawQueries.push(query);
  if (query.includes("INSERT INTO tenant")) return Promise.resolve([{ id: TENANT_ID }]);
  return Promise.resolve([]);
}

const sqlMock = Object.assign(
  function sqlTag() {
    return Promise.resolve([]);
  },
  {
    begin: (fn: (tx: unknown) => Promise<unknown>) => {
      void fn;
      return beginBehaviour();
    },
  },
);

vi.mock("@/lib/db", () => ({
  rawSql: rawSqlMock,
  sql: sqlMock,
  runWithTenantContext: async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
}));

const { createHostedTenant } = await import("@/lib/repositories/provisioning");

const PARAMS = {
  email: "buyer@example.com",
  displayName: "Buyer",
  company: "Example Corp",
  planCode: "TEAM" as const,
  lifecycleStatus: "ACTIVE" as const,
  billingCustomerId: null,
};

function ownerEmailConflict() {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint_name: "app_principal_magic_link_owner_email_idx",
  });
}

describe("createHostedTenant", () => {
  beforeEach(() => {
    rawQueries = [];
  });

  it("reports a conflict when another caller already owns the email", async () => {
    beginBehaviour = async () => {
      throw ownerEmailConflict();
    };

    const outcome = await createHostedTenant(PARAMS);

    expect(outcome).toEqual({ status: "conflict" });
  });

  it("removes the tenant it created when the dependent writes roll back", async () => {
    beginBehaviour = async () => {
      throw ownerEmailConflict();
    };

    await createHostedTenant(PARAMS);

    // Otherwise every losing webhook leaves an ownerless tenant behind.
    expect(rawQueries.some((q) => q.includes("DELETE FROM tenant"))).toBe(true);
  });

  it("removes the tenant when the dependent writes fail for any other reason", async () => {
    beginBehaviour = async () => {
      throw new Error("connection reset");
    };

    await expect(createHostedTenant(PARAMS)).rejects.toThrow("connection reset");
    expect(rawQueries.some((q) => q.includes("DELETE FROM tenant"))).toBe(true);
  });

  it("keeps the tenant when everything lands", async () => {
    beginBehaviour = async () => ({
      tenantId: TENANT_ID,
      workspaceId: "ws-1",
      principalId: "pr-1",
    });

    const outcome = await createHostedTenant(PARAMS);

    expect(outcome).toEqual({
      status: "created",
      tenant: { tenantId: TENANT_ID, workspaceId: "ws-1", principalId: "pr-1" },
    });
    expect(rawQueries.some((q) => q.includes("DELETE FROM tenant"))).toBe(false);
  });
});
