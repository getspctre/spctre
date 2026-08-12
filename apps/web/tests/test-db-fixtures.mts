import { randomUUID } from "crypto";
import { afterEach } from "vitest";
import { rawSql } from "../lib/db";

export interface TestTenantOptions {
  slugPrefix?: string;
  name?: string;
}

export interface TestTenantFixtureOptions {
  cleanup?: (tenantId: string) => Promise<void>;
}

/** Creates isolated tenants and removes every tenant created by this test file. */
export function createTestTenantFixture(options: TestTenantFixtureOptions = {}) {
  const tenantIds: string[] = [];

  afterEach(async () => {
    if (!rawSql) return;
    for (const tenantId of tenantIds.splice(0)) {
      await options.cleanup?.(tenantId);
      await rawSql`DELETE FROM tenant WHERE id = ${tenantId}`;
    }
  });

  return {
    async create(tenantOptions: TestTenantOptions = {}): Promise<string> {
      if (!rawSql) throw new Error("DATABASE_URL is required for repository contract tests.");
      const tenantId = randomUUID();
      const slugPrefix = tenantOptions.slugPrefix ?? "test-tenant";
      await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`${slugPrefix}-${tenantId}`}, ${tenantOptions.name ?? "Test tenant"})`;
      tenantIds.push(tenantId);
      return tenantId;
    },
  };
}
