import { createHash, randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

// Contract for POST /api/v1/policy/imports: the policy:import scope is required
// (a runtime bundle:read token is rejected), and import is idempotent on the
// branch identity + source hash — create (201), unchanged no-op (200,
// alreadyCurrent), changed source appends a new draft revision (200). It never
// approves or publishes.

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql } = await import("../lib/db");
const { POST } = await import("../app/api/v1/policy/imports/route");

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
  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`test-import-${tenantId}`}, 'Import test')`;
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${workspaceId}, ${tenantId}, 'acquisition', 'Acquisition')`;
  await rawSql`
    INSERT INTO app_principal (id, tenant_id, subject, display_name, principal_type)
    VALUES (${principalId}, ${tenantId}, ${`subject-${principalId}`}, 'Operator', 'USER')
  `;
  return { tenantId, workspaceId, principalId };
}

// Mints a service token with a unique raw value and returns it so the same
// value can be used in the request. Uniqueness avoids token_hash collisions
// across runs even if a prior run's cleanup was interrupted.
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

function importRequest(token: string, body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/v1/policy/imports", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pack(effectAction: string) {
  return [
    "metadata:",
    "  name: Import Test",
    "  connector: acquisition-scout",
    "rules:",
    "  - stable_rule_id: test.rule_one",
    "    title: Test rule",
    "    effect: ALLOW",
    "    connectors: [acquisition-scout]",
    `    actions: [${effectAction}]`,
  ].join("\n") + "\n";
}

async function revisionCount(branchId: string): Promise<number> {
  const rows = await rawSql!<{ count: string }[]>`SELECT count(*)::text FROM policy_revision WHERE branch_id = ${branchId}`;
  return Number(rows[0].count);
}

async function branchCount(tenantId: string, name: string): Promise<number> {
  const rows = await rawSql!<{ count: string }[]>`SELECT count(*)::text FROM policy_branch WHERE tenant_id = ${tenantId} AND name = ${name}`;
  return Number(rows[0].count);
}

afterEach(async () => {
  if (!rawSql) return;
  for (const tenantId of tenantIds.splice(0)) {
    // Break the branch → active revision FK cycle before deleting revisions.
    await rawSql`UPDATE policy_branch SET active_revision_id = NULL WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM policy_rule WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM policy_revision WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM policy_branch WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM service_token WHERE tenant_id = ${tenantId}`;
    await rawSql`DELETE FROM tenant WHERE id = ${tenantId}`;
  }
});

describe.skipIf(!databaseAvailable)("POST /api/v1/policy/imports contract", () => {
  it("rejects a token that lacks the policy:import scope", async () => {
    const fixture = await createFixture();
    const runtimeToken = await mintToken(fixture, ["bundle:read", "evidence:write"]);

    const response = await POST(importRequest(runtimeToken, { source: pack("research.fetch"), branchName: "acquisition-scout" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Token is missing policy:import scope." });
  });

  it("creates, no-ops on unchanged source, and appends on changed source", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    // 1. First import → create a new draft branch.
    const created = await POST(importRequest(operatorToken, {
      source: pack("research.fetch"),
      branchName: "acquisition-scout",
      scope: "CONNECTOR",
      connector: "acquisition-scout",
    }));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({ created: true, alreadyCurrent: false, ruleCount: 1 });
    const branchId = createdBody.branchId as string;
    expect(await revisionCount(branchId)).toBe(1);

    // 2. Re-import identical source → no-op.
    const same = await POST(importRequest(operatorToken, {
      source: pack("research.fetch"),
      branchName: "acquisition-scout",
      scope: "CONNECTOR",
      connector: "acquisition-scout",
    }));
    expect(same.status).toBe(200);
    await expect(same.json()).resolves.toMatchObject({ created: false, alreadyCurrent: true, branchId });
    expect(await revisionCount(branchId)).toBe(1);

    // 3. Re-import changed source → append a new draft revision to the same branch.
    const changed = await POST(importRequest(operatorToken, {
      source: pack("target.research"),
      branchName: "acquisition-scout",
      scope: "CONNECTOR",
      connector: "acquisition-scout",
    }));
    expect(changed.status).toBe(200);
    const changedBody = await changed.json();
    expect(changedBody).toMatchObject({ created: false, alreadyCurrent: false, branchId });
    expect(await revisionCount(branchId)).toBe(2);

    const head = await rawSql!<{ active_revision_id: string }[]>`SELECT active_revision_id FROM policy_branch WHERE id = ${branchId}`;
    expect(head[0].active_revision_id).toBe(changedBody.revisionId);
  });

  it("rejects a document with parse errors as 400", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    const response = await POST(importRequest(operatorToken, { source: "not: [valid", branchName: "acquisition-scout" }));
    expect(response.status).toBe(400);
  });

  it("serializes concurrent imports of the same branch identity (no duplicate branch, no 500)", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    const body = {
      source: pack("research.fetch"),
      branchName: "acquisition-scout",
      scope: "CONNECTOR",
      connector: "acquisition-scout",
    };

    // Fire several identical imports at once. With the per-identity advisory
    // lock they serialize: exactly one creates the branch (201) and the rest
    // observe it as already current (200) — never a unique-violation 500 or a
    // duplicate branch.
    const responses = await Promise.all(Array.from({ length: 6 }, () => POST(importRequest(operatorToken, body))));
    const statuses = responses.map((r) => r.status);

    expect(statuses.every((s) => s === 200 || s === 201)).toBe(true);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(await branchCount(fixture.tenantId, "acquisition-scout")).toBe(1);

    const created = responses[statuses.indexOf(201)];
    const { branchId } = await created.json();
    expect(await revisionCount(branchId)).toBe(1);
  });

  it("rejects a connector on a non-CONNECTOR scope as 400", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    const response = await POST(importRequest(operatorToken, {
      source: pack("research.fetch"),
      branchName: "acquisition-scout",
      scope: "WORKSPACE",
      connector: "acquisition-scout",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Connector is only valid") });
  });

  it("rejects ORGANIZATION scope from a workspace-bound token as 400", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    const response = await POST(importRequest(operatorToken, {
      source: pack("research.fetch"),
      branchName: "acquisition-scout",
      scope: "ORGANIZATION",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("workspace-bound") });
  });

  it("rejects a rules-empty (default-allow) document as 400", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    const emptyDoc = "metadata:\n  name: Empty\n  connector: acquisition-scout\nrules: []\n";
    const response = await POST(importRequest(operatorToken, { source: emptyDoc, branchName: "acquisition-scout" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("no rules") });
  });

  it("rejects a match-all rule with no connector/action/domain target as 400", async () => {
    const fixture = await createFixture();
    const operatorToken = await mintToken(fixture, ["policy:import"]);

    const matchAll = [
      "metadata:",
      "  name: Match all",
      "rules:",
      "  - stable_rule_id: bad.match_all",
      "    title: Match everything",
      "    effect: ALLOW",
    ].join("\n") + "\n";
    const response = await POST(importRequest(operatorToken, { source: matchAll, branchName: "acquisition-scout" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("match-all") });
  });
});
