import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestTenantFixture } from "./test-db-fixtures";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { insertPublicationAttestation } = await import("../lib/repositories/publication-attestations");

const testTenants = createTestTenantFixture();
const hash = `sha256:${"a".repeat(64)}`;
const attestedAt = "2026-08-13T18:00:00.000Z";

function fact<T>(value: T) {
  return {
    value,
    provenance: {
      class: "attested" as const,
      source: "publication-attestation-repository-test",
      recordedAt: attestedAt,
    },
  };
}

async function createFixture() {
  const tenantId = await testTenants.create({ slugPrefix: "test-publication", name: "Publication test" });
  const workspaceId = randomUUID();
  await rawSql!`
    INSERT INTO workspace (id, tenant_id, slug, name)
    VALUES (${workspaceId}, ${tenantId}, 'publication', 'Publication')
  `;
  await rawSql!`
    INSERT INTO publication_content_artifact
      (tenant_id, workspace_id, content_hash, media_type, size_bytes, content_encrypted)
    VALUES (${tenantId}, ${workspaceId}, ${hash}, 'application/octet-stream', 1, ${Buffer.from("x")})
  `;
  return { tenantId, workspaceId };
}

async function insertFixtureAttestation(fixture: { tenantId: string; workspaceId: string }) {
  const id = randomUUID();
  await runWithTenantContext(fixture.tenantId, () =>
    insertPublicationAttestation({
      tenantId: fixture.tenantId,
      workspaceId: fixture.workspaceId,
      idempotencyKey: `publication:${id}`,
      attestation: {
        schema: "spctre.publication-attestation.v1",
        attestationId: id,
        content: { hash, artifactRef: hash, version: "v1", identity: "article-1", modality: "text" },
        generation: { class: fact("generated") },
        editorial: { control: fact("reviewed") },
        publisher: { entityRef: fact("entity:test"), role: fact("publisher") },
        classification: {},
        disclosure: { decision: fact("not_required") },
        timestamps: { attestedAt: fact(attestedAt) },
      },
      receiptVerified: false,
      policyContext: {},
    }),
  );
  return id;
}

describe.skipIf(!databaseAvailable)("publication attestation repository contract", () => {
  it("binds the attestedAt fact value and permits tenant cascade deletion", async () => {
    const fixture = await createFixture();
    const id = await insertFixtureAttestation(fixture);

    await expect(rawSql!<{ attested_at: Date }[]>`
      SELECT attested_at FROM publication_attestation WHERE id = ${id}
    `).resolves.toEqual([{ attested_at: new Date(attestedAt) }]);

    await rawSql!`DELETE FROM tenant WHERE id = ${fixture.tenantId}`;
    await expect(rawSql!<{ count: string }[]>`
      SELECT count(*)::text AS count FROM publication_attestation WHERE id = ${id}
    `).resolves.toEqual([{ count: "0" }]);
  });
});
