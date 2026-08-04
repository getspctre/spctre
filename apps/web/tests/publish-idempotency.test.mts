import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { getExistingPublishArtifactHash, insertPolicyPublish } =
  await import("../lib/repositories/policy");

const tenantIds: string[] = [];

async function createFixture() {
  if (!rawSql) throw new Error("DATABASE_URL is required for repository contract tests.");
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const branchId = randomUUID();
  const revisionId = randomUUID();
  tenantIds.push(tenantId);
  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`test-publish-${tenantId}`}, 'Publish test')`;
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

afterEach(async () => {
  if (!rawSql) return;
  await Promise.all(
    tenantIds.splice(0).map((tenantId) => rawSql`DELETE FROM tenant WHERE id = ${tenantId}`),
  );
});

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
