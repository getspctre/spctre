import { createHash, randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql } = await import("../lib/db");
const { POST } = await import("../app/api/v1/ingest/providers/generic_json/route");

type Fixture = { tenantId: string; workspaceId: string; principalId: string };
const tenantIds: string[] = [];

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function createFixture(): Promise<Fixture> {
  if (!rawSql) throw new Error("DATABASE_URL is required for generic evidence contract tests.");
  const fixture = { tenantId: randomUUID(), workspaceId: randomUUID(), principalId: randomUUID() };
  tenantIds.push(fixture.tenantId);
  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${fixture.tenantId}, ${`test-evidence-${fixture.tenantId}`}, 'Evidence test')`;
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${fixture.workspaceId}, ${fixture.tenantId}, 'evidence', 'Evidence')`;
  await rawSql`
    INSERT INTO app_principal (id, tenant_id, subject, display_name, principal_type)
    VALUES (${fixture.principalId}, ${fixture.tenantId}, ${`subject-${fixture.principalId}`}, 'Operator', 'USER')
  `;
  return fixture;
}

async function createIntegration(fixture: Fixture, mapping: unknown) {
  const token = `test-evidence-${randomUUID()}`;
  const tokenRows = await rawSql<{ id: string }[]>`
    INSERT INTO service_token (tenant_id, workspace_id, principal_id, label, token_hash, token_prefix, scopes)
    VALUES (${fixture.tenantId}, ${fixture.workspaceId}, ${fixture.principalId}, 'Evidence test key',
      ${hashToken(token)}, ${token.slice(0, 16)}, ARRAY['evidence:write']::text[])
    RETURNING id
  `;
  const integrationRows = await rawSql<{ id: string }[]>`
    INSERT INTO evidence_ingest_integration (tenant_id, workspace_id, service_token_id, provider_type, name)
    VALUES (${fixture.tenantId}, ${fixture.workspaceId}, ${tokenRows[0]!.id}, 'generic_json', 'Test evidence')
    RETURNING id
  `;
  await rawSql`
    INSERT INTO evidence_ingest_mapping_revision (tenant_id, integration_id, version, field_mapping, activated_at)
    VALUES (${fixture.tenantId}, ${integrationRows[0]!.id}, 1, ${rawSql.json(mapping)}::jsonb, now())
  `;
  return { token, integrationId: integrationRows[0]!.id };
}

function request(token: string, integrationId: string, body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/v1/ingest/providers/generic_json", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-spctre-integration-id": integrationId,
    },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  if (!rawSql) return;
  for (const tenantId of tenantIds.splice(0))
    await rawSql`DELETE FROM tenant WHERE id = ${tenantId}`;
});

describe.skipIf(!databaseAvailable)("generic evidence ingest contract", () => {
  const mapping = { occurred_at: "$.timestamp", action: "$.action", source_event_id: "$.id" };

  it("retains a mapping rejection and reports 207", async () => {
    const fixture = await createFixture();
    const integration = await createIntegration(fixture, mapping);

    const response = await POST(
      request(integration.token, integration.integrationId, {
        id: "bad-1",
        timestamp: "2026-08-12T12:00:00Z",
      }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toMatchObject({ results: [{ outcome: "rejected" }] });
    await expect(rawSql<{ count: string; rejected_reason: string }[]>`
      SELECT count(*)::text, max(rejected_reason) AS rejected_reason
      FROM evidence_source_record WHERE integration_id = ${integration.integrationId}
    `).resolves.toEqual([
      { count: "1", rejected_reason: expect.stringContaining("action is required") },
    ]);
  });

  it("returns 201 then 200 for the same idempotency key", async () => {
    const fixture = await createFixture();
    const integration = await createIntegration(fixture, mapping);
    const payload = { id: "evt-1", timestamp: "2026-08-12T12:00:00Z", action: "filesystem.write" };

    expect(
      (await POST(request(integration.token, integration.integrationId, payload))).status,
    ).toBe(201);
    expect(
      (await POST(request(integration.token, integration.integrationId, payload))).status,
    ).toBe(200);
    await expect(rawSql<{ count: string }[]>`
      SELECT count(*)::text FROM evidence_source_record WHERE integration_id = ${integration.integrationId}
    `).resolves.toEqual([{ count: "1" }]);
  });

  it("commits the operations-log entry in the ingest transaction", async () => {
    const fixture = await createFixture();
    const integration = await createIntegration(fixture, mapping);

    const response = await POST(
      request(integration.token, integration.integrationId, {
        id: "audited-1",
        timestamp: "2026-08-12T12:00:00Z",
        action: "filesystem.write",
      }),
    );
    expect(response.status).toBe(201);

    // The append moved inside persistGenericEvidence's transaction, so this is
    // the only coverage of tx.json payload serialization and the chain-head
    // update against real Postgres; the unit suite mocks sql.begin entirely.
    const [entry] = await rawSql<
      {
        event_type: string;
        source_table: string;
        source_id: string;
        actor_id: string;
        payload: Record<string, unknown>;
        content_hash: string;
        prev_hash: string | null;
        last_hash: string;
      }[]
    >`
      SELECT log.event_type, log.source_table, log.source_id::text, log.actor_id::text,
             log.payload, log.content_hash, log.prev_hash, head.last_hash
      FROM agt_operations_log log
      JOIN agt_operations_log_chain_head head ON head.tenant_id = log.tenant_id
      WHERE log.tenant_id = ${fixture.tenantId}
    `;

    expect(entry).toMatchObject({
      event_type: "EVIDENCE_INGEST",
      source_table: "canonical_evidence_event",
      actor_id: fixture.principalId,
      payload: {
        integrationId: integration.integrationId,
        mappingVersion: 1,
        sourceEventId: "audited-1",
        action: "filesystem.write",
        enforcementDecision: "observe",
      },
    });
    // First entry for this tenant, and the chain head advanced to it.
    expect(entry!.prev_hash).toBeNull();
    expect(entry!.last_hash).toBe(entry!.content_hash);

    await expect(rawSql<{ id: string }[]>`
      SELECT id::text FROM canonical_evidence_event WHERE tenant_id = ${fixture.tenantId}
    `).resolves.toEqual([{ id: entry!.source_id }]);
  });

  it("returns 404 when an evidence token does not own the integration", async () => {
    const owner = await createFixture();
    const other = await createFixture();
    const integration = await createIntegration(owner, mapping);
    const otherToken = await createIntegration(other, mapping);

    const response = await POST(
      request(otherToken.token, integration.integrationId, {
        id: "foreign-1",
        timestamp: "2026-08-12T12:00:00Z",
        action: "filesystem.write",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when a same-tenant evidence token does not own the integration", async () => {
    const fixture = await createFixture();
    const owner = await createIntegration(fixture, mapping);
    const otherToken = await createIntegration(fixture, mapping);

    const response = await POST(
      request(otherToken.token, owner.integrationId, {
        id: "same-tenant-foreign-1",
        timestamp: "2026-08-12T12:00:00Z",
        action: "filesystem.write",
      }),
    );

    expect(response.status).toBe(404);
  });
});
