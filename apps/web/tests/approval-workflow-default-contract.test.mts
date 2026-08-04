import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { approvalRulesFromWorkflow, getApprovalWorkflowForContext } =
  await import("../lib/repositories/approval-workflow/config");

interface Fixture {
  tenantId: string;
  workspaceId: string;
  principalIds: string[];
}

const fixtures: Fixture[] = [];

async function createFixture(reviewerRoles: string[][]): Promise<Fixture> {
  if (!rawSql) throw new Error("DATABASE_URL is required for this contract test.");
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const principalIds = reviewerRoles.map(() => randomUUID());
  const fixture = { tenantId, workspaceId, principalIds };
  fixtures.push(fixture);

  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`test-workflow-${tenantId}`}, 'Workflow test')`;
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${workspaceId}, ${tenantId}, 'acquisition', 'Acquisition')`;
  for (const [index, principalId] of principalIds.entries()) {
    await rawSql`
      INSERT INTO app_principal (id, tenant_id, subject, display_name, principal_type)
      VALUES (${principalId}, ${tenantId}, ${`subject-${principalId}`}, ${`Reviewer ${index + 1}`}, 'USER')
    `;
    await rawSql`
      INSERT INTO principal_permission_grant (
        tenant_id, principal_id, workspace_id, reviewer_roles, publish_scopes, allowed_environments
      ) VALUES (
        ${tenantId}, ${principalId}, ${workspaceId}, ${reviewerRoles[index]}::text[], ARRAY[]::text[], ARRAY[]::text[]
      )
    `;
  }
  return fixture;
}

afterEach(async () => {
  if (!rawSql) return;
  for (const fixture of fixtures.splice(0)) {
    await rawSql`DELETE FROM principal_permission_grant WHERE tenant_id = ${fixture.tenantId}`;
    await rawSql`DELETE FROM app_principal WHERE tenant_id = ${fixture.tenantId}`;
    await rawSql`DELETE FROM workspace WHERE tenant_id = ${fixture.tenantId}`;
    await rawSql`DELETE FROM tenant WHERE id = ${fixture.tenantId}`;
  }
});

describe.skipIf(!databaseAvailable)("default approval workflow contract", () => {
  it("uses the sole reviewer's highest-priority eligible role", async () => {
    const fixture = await createFixture([["Security", "Platform"]]);

    const workflow = await runWithTenantContext(fixture.tenantId, () =>
      getApprovalWorkflowForContext({
        tenantId: fixture.tenantId,
        workspaceId: fixture.workspaceId,
      }),
    );

    expect(approvalRulesFromWorkflow(workflow)).toEqual([{ role: "Security", requiredCount: 1 }]);
  });

  it("collapses multiple eligible reviewers to a single satisfiable lane", async () => {
    const fixture = await createFixture([["Security"], ["Platform"]]);

    const workflow = await runWithTenantContext(fixture.tenantId, () =>
      getApprovalWorkflowForContext({
        tenantId: fixture.tenantId,
        workspaceId: fixture.workspaceId,
      }),
    );

    // policy_approval holds one row per reviewer identity and revision, so an
    // implicit multi-role default is unsatisfiable for a solo operator once a
    // second reviewer-capable principal exists. The unconfigured default picks
    // the single highest-priority lane an eligible reviewer can satisfy;
    // multi-role separation stays an explicit workflow choice.
    expect(approvalRulesFromWorkflow(workflow)).toEqual([{ role: "Security", requiredCount: 1 }]);
  });

  it("ignores pending, revoked, and IdP-deprovisioned reviewers", async () => {
    const fixture = await createFixture([["Security"], ["Platform"], ["Legal"], ["Ops"]]);
    await rawSql`UPDATE app_principal SET invite_status = 'PENDING' WHERE id = ${fixture.principalIds[1]}`;
    await rawSql`UPDATE app_principal SET invite_status = 'REVOKED' WHERE id = ${fixture.principalIds[2]}`;
    await rawSql`UPDATE app_principal SET idp_deprovisioned_at = now() WHERE id = ${fixture.principalIds[3]}`;

    const workflow = await runWithTenantContext(fixture.tenantId, () =>
      getApprovalWorkflowForContext({
        tenantId: fixture.tenantId,
        workspaceId: fixture.workspaceId,
      }),
    );

    expect(approvalRulesFromWorkflow(workflow)).toEqual([{ role: "Security", requiredCount: 1 }]);
  });
});
