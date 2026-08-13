import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestTenantFixture } from "./test-db-fixtures";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const {
  createPublicationSigningChallenge,
  insertPublicationAttestation,
  listPublicationAttestations,
} = await import("../lib/repositories/publication-attestations");

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
  const tenantId = await testTenants.create({
    slugPrefix: "test-publication",
    name: "Publication test",
  });
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

async function insertFixtureAttestation(
  fixture: { tenantId: string; workspaceId: string },
  options: { attestedAt?: string } = {},
) {
  const attestationId = randomUUID();
  const result = await runWithTenantContext(fixture.tenantId, () =>
    insertPublicationAttestation({
      tenantId: fixture.tenantId,
      workspaceId: fixture.workspaceId,
      idempotencyKey: `publication:${attestationId}`,
      attestation: {
        schema: "spctre.publication-attestation.v1",
        attestationId,
        content: {
          hash,
          artifactRef: hash,
          version: "v1",
          identity: "article-1",
          modality: "text",
        },
        generation: { class: fact("generated") },
        editorial: { control: fact("reviewed") },
        publisher: { entityRef: fact("entity:test"), role: fact("publisher") },
        classification: {},
        disclosure: { decision: fact("not_required") },
        timestamps: { attestedAt: fact(options.attestedAt ?? attestedAt) },
      },
      receiptVerified: false,
      policyContext: {},
    }),
  );
  return { recordId: result.id, attestationId };
}

describe.skipIf(!databaseAvailable)("publication attestation repository contract", () => {
  it("binds the attestedAt fact value and permits tenant cascade deletion", async () => {
    const fixture = await createFixture();
    const { recordId, attestationId } = await insertFixtureAttestation(fixture);
    expect(recordId).not.toBe(attestationId);

    await expect(rawSql!<{ attested_at: Date }[]>`
      SELECT attested_at FROM publication_attestation WHERE id = ${recordId}
    `).resolves.toEqual([{ attested_at: new Date(attestedAt) }]);

    await rawSql!`DELETE FROM tenant WHERE id = ${fixture.tenantId}`;
    await expect(rawSql!<{ count: string }[]>`
      SELECT count(*)::text AS count FROM publication_attestation WHERE id = ${recordId}
    `).resolves.toEqual([{ count: "0" }]);
  });

  it("replaces an expired or consumed signing challenge for the same key", async () => {
    const fixture = await createFixture();
    const first = await runWithTenantContext(fixture.tenantId, () =>
      createPublicationSigningChallenge({
        ...fixture,
        entityRef: "entity:test",
        keyId: "editorial-key-2026",
        publicKey: "public-key",
      }),
    );
    const retry = await runWithTenantContext(fixture.tenantId, () =>
      createPublicationSigningChallenge({
        ...fixture,
        entityRef: "entity:test",
        keyId: "editorial-key-2026",
        publicKey: "public-key",
      }),
    );

    expect(retry.id).not.toBe(first.id);
    await expect(rawSql!<{ count: string }[]>`
      SELECT count(*)::text AS count FROM publication_attestation_signing_challenge
      WHERE tenant_id = ${fixture.tenantId} AND workspace_id = ${fixture.workspaceId}
    `).resolves.toEqual([{ count: "1" }]);
  });

  it("uses the attested-at and ID pair for ledger pagination", async () => {
    const fixture = await createFixture();
    await insertFixtureAttestation(fixture);
    await insertFixtureAttestation(fixture);
    await insertFixtureAttestation(fixture);

    const firstPage = await runWithTenantContext(fixture.tenantId, () =>
      listPublicationAttestations({ ...fixture, limit: 1 }),
    );
    const secondPage = await runWithTenantContext(fixture.tenantId, () =>
      listPublicationAttestations({
        ...fixture,
        limit: 1,
        before: { attestedAt: firstPage[0]!.attestedAt, id: firstPage[0]!.id },
      }),
    );
    const thirdPage = await runWithTenantContext(fixture.tenantId, () =>
      listPublicationAttestations({
        ...fixture,
        limit: 1,
        before: { attestedAt: secondPage[0]!.attestedAt, id: secondPage[0]!.id },
      }),
    );

    expect(
      new Set([...firstPage, ...secondPage, ...thirdPage].map((record) => record.id)).size,
    ).toBe(3);
  });
});
