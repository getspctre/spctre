import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createTestTenantFixture } from "./test-db-fixtures";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { getExistingPublishArtifactHash, insertPolicyPublish } =
  await import("../lib/repositories/policy");

const testTenants = createTestTenantFixture();

async function createFixture() {
  const tenantId = await testTenants.create({ slugPrefix: "test-publish", name: "Publish test" });
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
  return { tenantId, branchId, revisionId };
}

describe.skipIf(!databaseAvailable)("policy publish idempotency repository contract", () => {
  it("finds an existing production publication and leaves one durable publish record", async () => {
    const fixture = await createFixture();
    const artifactHash = "sha256:published-artifact";

    await runWithTenantContext(fixture.tenantId, () =>
      insertPolicyPublish({ ...fixture, artifactHash, actorId: "actor-test" }),
    );
    await expect(
      runWithTenantContext(fixture.tenantId, () => getExistingPublishArtifactHash(fixture)),
    ).resolves.toBe(artifactHash);
    await expect(rawSql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM policy_publish
      WHERE tenant_id = ${fixture.tenantId} AND branch_id = ${fixture.branchId} AND revision_id = ${fixture.revisionId}
    `).resolves.toEqual([{ count: "1" }]);
  });
});
