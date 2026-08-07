import { createHash, randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { authenticateServiceToken } = await import("../lib/repositories/auth/service-tokens");

type Fixture = { tenantId: string; workspaceId: string; principalId: string };
const tenantIds: string[] = [];

function hashServiceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestWithAuth(value?: string) {
  return new Request("http://localhost:3000/api/evidence", {
    headers: value ? { authorization: value } : {},
  });
}

async function createFixture(): Promise<Fixture> {
  if (!rawSql) throw new Error("DATABASE_URL is required for repository contract tests.");
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const principalId = randomUUID();
  tenantIds.push(tenantId);
  await rawSql`INSERT INTO tenant (id, slug, name) VALUES (${tenantId}, ${`test-token-${tenantId}`}, 'Token test')`;
  await rawSql`INSERT INTO workspace (id, tenant_id, slug, name) VALUES (${workspaceId}, ${tenantId}, 'test', 'Test workspace')`;
  await rawSql`
    INSERT INTO app_principal (id, tenant_id, subject, display_name, principal_type)
    VALUES (${principalId}, ${tenantId}, ${`subject-${principalId}`}, 'Test principal', 'USER')
  `;
  return { tenantId, workspaceId, principalId };
}

async function issueToken(
  fixture: Fixture,
  rawToken: string,
  scopes: string[],
  options: { expired?: boolean; revoked?: boolean } = {},
) {
  await rawSql`
    INSERT INTO service_token (tenant_id, workspace_id, principal_id, label, token_hash, token_prefix, scopes, expires_at, revoked_at)
    VALUES (
      ${fixture.tenantId}, ${fixture.workspaceId}, ${fixture.principalId}, 'test token',
      ${hashServiceToken(rawToken)}, ${rawToken.slice(0, 16)}, ${scopes}::text[],
      ${options.expired ? new Date(Date.now() - 60_000).toISOString() : null},
      ${options.revoked ? new Date().toISOString() : null}
    )
  `;
}

afterEach(async () => {
  if (!rawSql) return;
  await Promise.all(
    tenantIds.splice(0).map((tenantId) => rawSql`DELETE FROM tenant WHERE id = ${tenantId}`),
  );
});

describe.skipIf(!databaseAvailable)("service token authentication contract", () => {
  it("rejects missing bearer tokens", async () => {
    const fixture = await createFixture();
    await expect(
      runWithTenantContext(fixture.tenantId, () =>
        authenticateServiceToken(requestWithAuth(), "evidence:write"),
      ),
    ).resolves.toEqual({ ok: false, error: "Missing bearer token." });
  });

  it("rejects expired and revoked tokens", async () => {
    const fixture = await createFixture();
    await issueToken(fixture, "expired-token", ["evidence:write"], { expired: true });
    await issueToken(fixture, "revoked-token", ["evidence:write"], { revoked: true });

    await expect(
      runWithTenantContext(fixture.tenantId, () =>
        authenticateServiceToken(requestWithAuth("Bearer expired-token"), "evidence:write"),
      ),
    ).resolves.toEqual({ ok: false, error: "Missing or invalid bearer token." });
    await expect(
      runWithTenantContext(fixture.tenantId, () =>
        authenticateServiceToken(requestWithAuth("Bearer revoked-token"), "evidence:write"),
      ),
    ).resolves.toEqual({ ok: false, error: "Missing or invalid bearer token." });
  });

  it("does not record use when the required scope is absent", async () => {
    const fixture = await createFixture();
    await issueToken(fixture, "limited-token", ["bundle:read"]);

    await expect(
      runWithTenantContext(fixture.tenantId, () =>
        authenticateServiceToken(requestWithAuth("Bearer limited-token"), "evidence:write"),
      ),
    ).resolves.toEqual({ ok: false, error: "Token is missing evidence:write scope." });
    await expect(rawSql<{ last_used_at: Date | null }[]>`
      SELECT last_used_at FROM service_token WHERE token_hash = ${hashServiceToken("limited-token")}
    `).resolves.toEqual([{ last_used_at: null }]);
  });

  it("returns scoped auth context and records successful use", async () => {
    const fixture = await createFixture();
    await issueToken(fixture, "active-token", ["bundle:read", "evidence:write"]);

    await expect(
      runWithTenantContext(fixture.tenantId, () =>
        authenticateServiceToken(requestWithAuth("Bearer active-token"), "evidence:write"),
      ),
    ).resolves.toEqual({
      ok: true,
      auth: {
        tokenId: expect.any(String),
        tenantId: fixture.tenantId,
        workspaceId: fixture.workspaceId,
        principalId: fixture.principalId,
        evidenceExportGrants: [],
        scopes: ["bundle:read", "evidence:write"],
      },
    });
    await expect(rawSql<{ last_used_at: Date | null }[]>`
      SELECT last_used_at FROM service_token WHERE token_hash = ${hashServiceToken("active-token")}
    `).resolves.toEqual([{ last_used_at: expect.any(Date) }]);
  });

  it("authenticates a valid token before a tenant context is available", async () => {
    const fixture = await createFixture();
    await issueToken(fixture, "pre-auth-token", ["bundle:read"]);

    await expect(
      authenticateServiceToken(requestWithAuth("Bearer pre-auth-token"), "bundle:read"),
    ).resolves.toEqual({
      ok: true,
      auth: {
        tokenId: expect.any(String),
        tenantId: fixture.tenantId,
        workspaceId: fixture.workspaceId,
        principalId: fixture.principalId,
        evidenceExportGrants: [],
        scopes: ["bundle:read"],
      },
    });
  });
});
