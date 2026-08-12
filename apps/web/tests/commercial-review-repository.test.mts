import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createTestTenantFixture } from "./test-db-fixtures";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { requestCommercialReview } = await import("../lib/repositories/workspace");

const testTenants = createTestTenantFixture();

async function createFixture() {
  const tenantId = await testTenants.create({
    slugPrefix: "test-commercial",
    name: "Commercial test",
  });
  const workspaceId = randomUUID();
  const principalId = randomUUID();
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${workspaceId}, ${tenantId}, 'test', 'Test workspace')`;
  await rawSql`
    INSERT INTO app_principal (id, tenant_id, subject, display_name, principal_type)
    VALUES (${principalId}, ${tenantId}, ${`subject-${principalId}`}, 'Test principal', 'USER')
  `;
  return { tenantId, workspaceId, principalId };
}

describe.skipIf(!databaseAvailable)("commercial review repository contract", () => {
  it("creates a Hosted Trial review profile and durable commercial/audit records", async () => {
    const fixture = await createFixture();
    await runWithTenantContext(fixture.tenantId, () =>
      requestCommercialReview({
        ...fixture,
        targetPlan: "BUSINESS",
        note: "Need SSO",
        workspaceSlug: "test",
        requestedBy: "buyer@example.test",
      }),
    );

    await expect(rawSql<{ plan_code: string; lifecycle_status: string; sales_status: string }[]>`
      SELECT plan_code, lifecycle_status, sales_status FROM tenant_commercial_profile
      WHERE tenant_id = ${fixture.tenantId}
    `).resolves.toEqual([
      { plan_code: "HOSTED_TRIAL", lifecycle_status: "EVALUATING", sales_status: "REQUESTED" },
    ]);
    await expect(rawSql<
      { event_type: string; target_plan: string; note: string; requested_by: string }[]
    >`
      SELECT event_type, target_plan, metadata->>'note' AS note, metadata->>'requestedBy' AS requested_by
      FROM commercial_event WHERE tenant_id = ${fixture.tenantId}
    `).resolves.toEqual([
      {
        event_type: "COMMERCIAL_REVIEW_REQUESTED",
        target_plan: "BUSINESS",
        note: "Need SSO",
        requested_by: "buyer@example.test",
      },
    ]);
    await expect(rawSql<{ action: string; outcome: string; target_plan: string }[]>`
      SELECT action, outcome, metadata->>'targetPlan' AS target_plan FROM admin_audit_event
      WHERE tenant_id = ${fixture.tenantId} AND action = 'commercial.review_request'
    `).resolves.toEqual([
      { action: "commercial.review_request", outcome: "ALLOWED", target_plan: "BUSINESS" },
    ]);
  });
});
