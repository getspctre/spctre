import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { recordConversionTelemetry } = await import("../lib/repositories/onboarding/telemetry");

const tenantIds: string[] = [];

async function createTenant(): Promise<string> {
  if (!rawSql) throw new Error("DATABASE_URL is required for repository contract tests.");
  const tenantId = randomUUID();
  tenantIds.push(tenantId);
  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`test-telemetry-${tenantId}`}, 'Telemetry test')`;
  return tenantId;
}

afterEach(async () => {
  if (!rawSql) return;
  await Promise.all(
    tenantIds.splice(0).map((tenantId) => rawSql`DELETE FROM tenant WHERE id = ${tenantId}`),
  );
});

describe.skipIf(!databaseAvailable)("conversion telemetry repository contract", () => {
  it("records a first-occurrence event once and preserves structured metadata", async () => {
    const tenantId = await createTenant();
    await runWithTenantContext(tenantId, async () => {
      await recordConversionTelemetry(tenantId, "TRIAL_CONVERTED", {
        billingProvider: "PADDLE",
        planCode: "TEAM",
      });
      await recordConversionTelemetry(tenantId, "TRIAL_CONVERTED", {
        billingProvider: "PADDLE",
        planCode: "TEAM",
      });
    });

    await expect(rawSql<{ count: string; provider: string; plan_code: string }[]>`
      SELECT count(*)::text AS count, min(metadata->>'billingProvider') AS provider,
        min(metadata->>'planCode') AS plan_code
      FROM conversion_telemetry_event
      WHERE tenant_id = ${tenantId} AND event_type = 'TRIAL_CONVERTED'
    `).resolves.toEqual([{ count: "1", provider: "PADDLE", plan_code: "TEAM" }]);
  });

  it("appends lifecycle events that are intentionally repeatable", async () => {
    const tenantId = await createTenant();
    await runWithTenantContext(tenantId, async () => {
      await recordConversionTelemetry(tenantId, "PLAN_CHANGED", { planCode: "TEAM" });
      await recordConversionTelemetry(tenantId, "PLAN_CHANGED", { planCode: "BUSINESS" });
    });

    await expect(rawSql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM conversion_telemetry_event
      WHERE tenant_id = ${tenantId} AND event_type = 'PLAN_CHANGED'
    `).resolves.toEqual([{ count: "2" }]);
  });
});
