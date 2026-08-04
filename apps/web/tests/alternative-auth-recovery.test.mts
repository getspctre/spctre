import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

// These are repository contract tests. They intentionally use the migrated
// Postgres service configured by the web-integration CI job instead of
// asserting query text, query order, or mock call counts.
const databaseAvailable = Boolean(process.env.DATABASE_URL);
const { rawSql, runWithTenantContext } = await import("../lib/db");
const { linkSocialIdentity, unlinkSocialIdentity, listLinkedSocialIdentities } =
  await import("../lib/repositories/auth/principal");
const { generateRecoveryCodes, consumeRecoveryCode } =
  await import("../lib/repositories/auth/recovery");
const { listPrincipalSessions, revokeSessionAndRecord } =
  await import("../lib/repositories/auth/session");

type Fixture = { tenantId: string; principalId: string; workspaceId: string };

const tenantIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  if (!rawSql) throw new Error("DATABASE_URL is required for repository contract tests.");
  const tenantId = randomUUID();
  const principalId = randomUUID();
  const workspaceId = randomUUID();
  tenantIds.push(tenantId);

  await rawSql`
    INSERT INTO tenant (id, slug, name)
    VALUES (${tenantId}, ${`test-auth-${tenantId}`}, 'Auth repository test')
  `;
  await rawSql`
    INSERT INTO workspace (id, tenant_id, slug, name)
    VALUES (${workspaceId}, ${tenantId}, 'test', 'Test workspace')
  `;
  await rawSql`
    INSERT INTO app_principal (id, tenant_id, subject, display_name, email, principal_type)
    VALUES (${principalId}, ${tenantId}, ${`subject-${principalId}`}, 'Test principal', ${`test-${principalId}@example.test`}, 'USER')
  `;
  return { tenantId, principalId, workspaceId };
}

afterEach(async () => {
  if (!rawSql) return;
  await Promise.all(
    tenantIds.splice(0).map((tenantId) => rawSql`DELETE FROM tenant WHERE id = ${tenantId}`),
  );
});

describe.skipIf(!databaseAvailable)(
  "Alternative Auth & Account Recovery repository contracts",
  () => {
    it("links, lists, and unlinks a social identity without affecting another tenant", async () => {
      const fixture = await createFixture();
      const other = await createFixture();

      await linkSocialIdentity({
        principalId: fixture.principalId,
        tenantId: fixture.tenantId,
        provider: "GOOGLE",
        providerSubject: "sub-google",
        providerEmail: "google@example.com",
      });

      await expect(
        listLinkedSocialIdentities({
          principalId: fixture.principalId,
          tenantId: fixture.tenantId,
        }),
      ).resolves.toEqual([{ provider: "GOOGLE", externalEmail: "google@example.com" }]);
      await expect(
        listLinkedSocialIdentities({ principalId: other.principalId, tenantId: other.tenantId }),
      ).resolves.toEqual([]);

      await unlinkSocialIdentity({
        principalId: fixture.principalId,
        tenantId: fixture.tenantId,
        provider: "GOOGLE",
      });

      await expect(
        listLinkedSocialIdentities({
          principalId: fixture.principalId,
          tenantId: fixture.tenantId,
        }),
      ).resolves.toEqual([]);
    });

    it("issues one-time recovery codes", async () => {
      const fixture = await createFixture();
      const codes = await generateRecoveryCodes(fixture);

      expect(codes).toHaveLength(8);
      await expect(consumeRecoveryCode({ ...fixture, code: codes[0]! })).resolves.toBe(true);
      await expect(consumeRecoveryCode({ ...fixture, code: codes[0]! })).resolves.toBe(false);
      await expect(consumeRecoveryCode({ ...fixture, code: "WRONGCODE" })).resolves.toBe(false);

      const remaining = await rawSql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM recovery_code
      WHERE tenant_id = ${fixture.tenantId} AND principal_id = ${fixture.principalId} AND used_at IS NULL
    `;
      expect(remaining[0]?.count).toBe("7");
    });

    it("lists active sessions and records both durable revocation events", async () => {
      const fixture = await createFixture();
      const activeSessionId = randomUUID();
      const expiredSessionId = randomUUID();
      await rawSql`
      INSERT INTO app_session (id, tenant_id, principal_id, expires_at, user_agent, ip_address)
      VALUES
        (${activeSessionId}, ${fixture.tenantId}, ${fixture.principalId}, now() + interval '1 hour', 'Test browser', '127.0.0.1'),
        (${expiredSessionId}, ${fixture.tenantId}, ${fixture.principalId}, now() - interval '1 hour', 'Expired browser', '127.0.0.2')
    `;

      await expect(
        runWithTenantContext(fixture.tenantId, () =>
          listPrincipalSessions({ tenantId: fixture.tenantId, principalId: fixture.principalId }),
        ),
      ).resolves.toMatchObject([
        { id: activeSessionId, user_agent: "Test browser", ip_address: "127.0.0.1" },
      ]);

      await runWithTenantContext(fixture.tenantId, () =>
        revokeSessionAndRecord({
          sessionId: activeSessionId,
          tenantId: fixture.tenantId,
          principalId: fixture.principalId,
          actorId: "actor-test",
          source: "LOCAL",
        }),
      );

      await expect(
        runWithTenantContext(fixture.tenantId, () =>
          listPrincipalSessions({ tenantId: fixture.tenantId, principalId: fixture.principalId }),
        ),
      ).resolves.toEqual([]);
      await expect(rawSql<
        { event_type: string; session_id: string; ip_address: string; user_agent: string }[]
      >`
      SELECT event_type, detail->>'sessionId' AS session_id,
        detail->>'ipAddress' AS ip_address, detail->>'userAgent' AS user_agent
      FROM agt_identity_lifecycle_event
      WHERE tenant_id = ${fixture.tenantId} AND principal_id = ${fixture.principalId}
    `).resolves.toEqual([
        {
          event_type: "SESSION_REVOKED",
          session_id: activeSessionId,
          ip_address: "127.0.0.1",
          user_agent: "Test browser",
        },
      ]);
      await expect(rawSql<{ event_type: string; source_id: string; source_table: string }[]>`
      SELECT event_type, source_id, source_table FROM agt_operations_log
      WHERE tenant_id = ${fixture.tenantId} AND source_id = ${activeSessionId}
    `).resolves.toEqual([
        { event_type: "IDENTITY_CHANGE", source_id: activeSessionId, source_table: "app_session" },
      ]);
    });
  },
);
