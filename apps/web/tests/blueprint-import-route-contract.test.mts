import { createHash, randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

// Contract for POST /api/v1/blueprint/imports: the blueprint:import scope is
// required (a runtime bundle:read token is rejected); the import is FAIL-CLOSED
// on the policy binding (409 when the named policy branch has no published
// revision); and it is idempotent on (agentId + bound definition hash) — create
// (201), unchanged no-op (200, alreadyCurrent), changed definition appends a new
// draft revision (200). It never approves or publishes.

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql } = await import("../lib/db");
const { POST } = await import("../app/api/v1/blueprint/imports/route");

type Fixture = { tenantId: string; workspaceId: string; principalId: string };
const tenantIds: string[] = [];

function hashServiceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function createFixture(): Promise<Fixture> {
  if (!rawSql) throw new Error("DATABASE_URL is required for this contract test.");
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const principalId = randomUUID();
  tenantIds.push(tenantId);
  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`test-bp-${tenantId}`}, 'Blueprint test')`;
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${workspaceId}, ${tenantId}, 'acquisition', 'Acquisition')`;
  await rawSql`
    INSERT INTO app_principal (id, tenant_id, subject, display_name, principal_type)
    VALUES (${principalId}, ${tenantId}, ${`subject-${principalId}`}, 'Operator', 'USER')
  `;
  return { tenantId, workspaceId, principalId };
}

async function mintToken(fixture: Fixture, scopes: string[]): Promise<string> {
  const rawToken = `test-${randomUUID()}`;
  await rawSql!`
    INSERT INTO service_token (tenant_id, workspace_id, principal_id, label, token_hash, token_prefix, scopes)
    VALUES (
      ${fixture.tenantId}, ${fixture.workspaceId}, ${fixture.principalId}, 'test key',
      ${hashServiceToken(rawToken)}, ${rawToken.slice(0, 16)}, ${scopes}::text[]
    )
  `;
  return rawToken;
}

// Seeds a CONNECTOR policy branch with a single PUBLISHED revision so the import
// can resolve and bind to it. Returns the resolved branch and revision ids.
async function seedPublishedPolicy(fixture: Fixture, branchName: string): Promise<{ branchId: string; revisionId: string }> {
  const branchId = randomUUID();
  const revisionId = randomUUID();
  await rawSql!`
    INSERT INTO policy_branch (id, tenant_id, workspace_id, scope, connector, name, created_by)
    VALUES (${branchId}, ${fixture.tenantId}, ${fixture.workspaceId}, 'CONNECTOR', ${branchName}, ${branchName}, ${fixture.principalId})
  `;
  await rawSql!`
    INSERT INTO policy_revision (id, tenant_id, workspace_id, branch_id, source_format, source_document, source_hash, author_id, message)
    VALUES (${revisionId}, ${fixture.tenantId}, ${fixture.workspaceId}, ${branchId}, 'AGT_YAML', ${rawSql!.json({})}::jsonb, 'sha256:seed', ${fixture.principalId}, 'seed')
  `;
  await rawSql!`UPDATE policy_branch SET active_revision_id = ${revisionId} WHERE id = ${branchId}`;
  await rawSql!`
    INSERT INTO policy_publish (tenant_id, workspace_id, branch_id, revision_id, environment, runtime_stack, artifact_hash, published_by)
    VALUES (${fixture.tenantId}, ${fixture.workspaceId}, ${branchId}, ${revisionId}, 'production', 'CUSTOM', 'sha256:artifact', ${fixture.principalId})
  `;
  return { branchId, revisionId };
}

function blueprintSource(params: { agentId?: string; policyBranch: string; purpose?: string }): string {
  return [
    "name: Acquisition Scout",
    `agentId: ${params.agentId ?? "scout"}`,
    "message: Read-only researcher",
    "definition:",
    `  purpose: ${params.purpose ?? "Read-only acquisition researcher."}`,
    "  allowedTaskClasses: [research]",
    "  tools: [research.fetch]",
    "  connectors: [acquisition-scout]",
    "  services: [github]",
    "  environments: [production]",
    "  runtimeTargets:",
    "    - stack: CUSTOM",
    "      adapter: spctre-scout",
    `  policyBranchId: ${params.policyBranch}`,
  ].join("\n") + "\n";
}

function importRequest(token: string, source: string) {
  return new Request("http://localhost:3000/api/v1/blueprint/imports", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ source }),
  });
}

async function blueprintRevisionCount(blueprintId: string): Promise<number> {
  const rows = await rawSql!<{ count: string }[]>`SELECT count(*)::text FROM agent_blueprint_revision WHERE blueprint_id = ${blueprintId}`;
  return Number(rows[0].count);
}

afterEach(async () => {
  if (!rawSql) return;
  for (const tenantId of tenantIds.splice(0)) {
    // Break the blueprint → active revision FK cycle before deleting revisions.
    await rawSql`UPDATE agent_blueprint SET active_revision_id = NULL WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM agent_blueprint_approval WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM agent_blueprint_revision WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM agent_blueprint WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM policy_publish WHERE tenant_id = ${tenantId}`;
    await rawSql`UPDATE policy_branch SET active_revision_id = NULL WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM policy_revision WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM policy_branch WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM service_token WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM tenant WHERE id = ${tenantId}`;
  }
});

describe.skipIf(!databaseAvailable)("POST /api/v1/blueprint/imports contract", () => {
  it("rejects a token that lacks the blueprint:import scope", async () => {
    const fixture = await createFixture();
    await seedPublishedPolicy(fixture, "acquisition-scout");
    const runtimeToken = await mintToken(fixture, ["bundle:read", "evidence:write"]);

    const response = await POST(importRequest(runtimeToken, blueprintSource({ policyBranch: "acquisition-scout" })));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Token is missing blueprint:import scope." });
  });

  it("fails closed (409) when the policy branch has no published revision", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["blueprint:import"]);

    // No seedPublishedPolicy — the branch is unpublished (or absent).
    const response = await POST(importRequest(operatorToken, blueprintSource({ policyBranch: "acquisition-scout" })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("no published revision"),
    });
  });

  it("creates a draft bound to the published revision, no-ops unchanged, and appends on change", async () => {
    const fixture = await createFixture();
    const published = await seedPublishedPolicy(fixture, "acquisition-scout");
    const operatorToken = await mintToken(fixture, ["blueprint:import"]);

    // 1. First import → create a DRAFT Blueprint bound to the published revision.
    const created = await POST(importRequest(operatorToken, blueprintSource({ policyBranch: "acquisition-scout" })));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({
      created: true,
      alreadyCurrent: false,
      policyBranchId: published.branchId,
      policyRevisionId: published.revisionId,
    });
    const blueprintId = createdBody.blueprintId as string;
    expect(await blueprintRevisionCount(blueprintId)).toBe(1);

    // 2. Re-import identical source → no-op.
    const same = await POST(importRequest(operatorToken, blueprintSource({ policyBranch: "acquisition-scout" })));
    expect(same.status).toBe(200);
    await expect(same.json()).resolves.toMatchObject({ created: false, alreadyCurrent: true, blueprintId });
    expect(await blueprintRevisionCount(blueprintId)).toBe(1);

    // 3. Re-import changed definition → append a new draft revision.
    const changed = await POST(importRequest(operatorToken, blueprintSource({ policyBranch: "acquisition-scout", purpose: "A different purpose." })));
    expect(changed.status).toBe(200);
    const changedBody = await changed.json();
    expect(changedBody).toMatchObject({ created: false, alreadyCurrent: false, blueprintId });
    expect(await blueprintRevisionCount(blueprintId)).toBe(2);

    const head = await rawSql!<{ active_revision_id: string }[]>`SELECT active_revision_id FROM agent_blueprint WHERE id = ${blueprintId}`;
    expect(head[0].active_revision_id).toBe(changedBody.revisionId);
  });

  it("rejects a source that pins policyRevisionId as 400", async () => {
    const fixture = await createFixture();
    await seedPublishedPolicy(fixture, "acquisition-scout");
    const operatorToken = await mintToken(fixture, ["blueprint:import"]);

    const source = blueprintSource({ policyBranch: "acquisition-scout" }) + "  policyRevisionId: rev_forbidden\n";
    const response = await POST(importRequest(operatorToken, source));
    expect(response.status).toBe(400);
  });

  it("rejects a definition missing a required field as 400", async () => {
    const fixture = await createFixture();
    await seedPublishedPolicy(fixture, "acquisition-scout");
    const operatorToken = await mintToken(fixture, ["blueprint:import"]);

    // purpose is required by parseAgentBlueprintDefinition.
    const source = [
      "name: Broken",
      "agentId: scout",
      "definition:",
      "  allowedTaskClasses: [research]",
      "  tools: [research.fetch]",
      "  connectors: [acquisition-scout]",
      "  services: [github]",
      "  environments: [production]",
      "  runtimeTargets: [{ stack: CUSTOM }]",
      "  policyBranchId: acquisition-scout",
    ].join("\n") + "\n";
    const response = await POST(importRequest(operatorToken, source));
    expect(response.status).toBe(400);
  });
});
