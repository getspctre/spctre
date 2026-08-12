import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { buildSimulationRun } from "@spctre/policy-schema";
import { createTestTenantFixture } from "./test-db-fixtures";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { getLatestManagedSimulationRegression, persistSimulationRun } =
  await import("../lib/repositories/evidence/simulation");
const { createDraftRevision } = await import("../lib/repositories/policy/branches");

const testTenants = createTestTenantFixture();

async function createFixture() {
  const tenantId = await testTenants.create({
    slugPrefix: "test-simulation",
    name: "Simulation test",
  });
  const workspaceId = randomUUID();
  const branchId = randomUUID();
  const revisionId = randomUUID();
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${workspaceId}, ${tenantId}, 'test', 'Test workspace')`;
  await rawSql`
    INSERT INTO policy_branch (id, tenant_id, workspace_id, scope, name, created_by)
    VALUES (${branchId}, ${tenantId}, ${workspaceId}, 'WORKSPACE', 'Test branch', 'actor-test')
  `;
  await rawSql`
    INSERT INTO policy_revision (id, tenant_id, workspace_id, branch_id, source_format, source_document, source_hash, author_id, message)
    VALUES (${revisionId}, ${tenantId}, ${workspaceId}, ${branchId}, 'AGT_YAML', '{}'::jsonb, 'sha256:source', 'actor-test', 'Test revision')
  `;
  return { tenantId, workspaceId, branchId, revisionId };
}

describe.skipIf(!databaseAvailable)("simulation run persistence repository contract", () => {
  it("round-trips retained-log regression metadata and replay findings as JSONB", async () => {
    const fixture = await createFixture();
    const run = buildSimulationRun({
      id: "sim-test",
      branchId: fixture.branchId,
      revisionId: fixture.revisionId,
      sourceEventCount: 1,
      createdBy: "tester",
      createdAt: "2026-07-31T00:00:00.000Z",
      results: [
        {
          eventId: "decision-1",
          connector: "github",
          action: "repo.read",
          previousStatus: "ALLOW",
          proposedStatus: "ALLOW",
          delta: "UNCHANGED",
          matchedPolicyRefs: [],
          reason: "Allowed.",
        },
      ],
      regressionSummary: {
        coverage: "RETAINED_LOG",
        newlyDeniedExpectedWorkCount: 0,
        removedEscalationCoverageCount: 0,
        newlyAllowedHighRiskCount: 0,
        blockingCount: 0,
      },
    });

    const runId = await runWithTenantContext(fixture.tenantId, () =>
      persistSimulationRun(run, fixture.workspaceId, fixture.tenantId),
    );
    expect(runId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(
      runWithTenantContext(fixture.tenantId, () => getLatestManagedSimulationRegression(fixture)),
    ).resolves.toMatchObject({ coverage: "RETAINED_LOG", blockingCount: 0 });
    await expect(rawSql<{ coverage: string; findings: string }[]>`
      SELECT regression_summary->>'coverage' AS coverage, count(f.id)::text AS findings
      FROM simulation_run sr LEFT JOIN simulation_replay_finding f ON f.simulation_run_id = sr.id
      WHERE sr.id = ${runId}::uuid GROUP BY sr.regression_summary
    `).resolves.toEqual([{ coverage: "RETAINED_LOG", findings: "1" }]);
  });

  it("persists primary policy source documents as JSONB objects", async () => {
    const fixture = await createFixture();
    const draftRevisionId = randomUUID();
    await runWithTenantContext(fixture.tenantId, () =>
      createDraftRevision({
        tenantId: fixture.tenantId,
        draftRevisionId,
        branchId: fixture.branchId,
        baseRevisionId: fixture.revisionId,
        baseWorkspaceId: fixture.workspaceId,
        sourceFormat: "AGT_YAML",
        sourcePath: "policy.yaml",
        sourceDocument: { rules: [], metadata: { authoredInApp: true } },
        sourceHash: "sha256:draft",
        actorId: "actor-test",
        message: "Draft revision",
      }),
    );

    await expect(rawSql<{ type: string; authored_in_app: string }[]>`
      SELECT jsonb_typeof(source_document) AS type,
             source_document->'metadata'->>'authoredInApp' AS authored_in_app
      FROM policy_revision
      WHERE id = ${draftRevisionId}
    `).resolves.toEqual([{ type: "object", authored_in_app: "true" }]);
  });
});
