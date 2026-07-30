import { sql, rawSql } from "@/lib/db";

export interface PrincipalPasskey {
  id: string;
  name: string | null;
  credentialIdB64: string;
  createdAt: string;
  usedAt: string | null;
}

export interface PrincipalMfaEnrollment {
  id: string;
  mfaType: "TOTP" | "SMS";
  verifiedAt: string | null;
  createdAt: string;
  phoneNumber?: string | null;
}

export interface TenantMfaSettings {
  requireMfa: boolean;
  mfaGraceDays: number;
}

export interface RevocationRecord {
  tokenId: string;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  scopes: string[];
  revokedAt: string;
  createdAt: string;
}

function credentialKey(): string {
  const key = process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set.");
  return key;
}

export async function listPrincipalPasskeys(
  principalId: string,
  tenantId: string
): Promise<PrincipalPasskey[]> {
  if (!sql || !principalId) return [];

  const rows = await sql<
    {
      id: string;
      name: string | null;
      credential_id_b64: string;
      created_at: Date;
      used_at: Date | null;
    }[]
  >`
    SELECT id, name, credential_id_b64, created_at, used_at
    FROM passkey
    WHERE tenant_id = ${tenantId}
      AND principal_id = ${principalId}
    ORDER BY created_at DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? null,
    credentialIdB64: row.credential_id_b64,
    createdAt: row.created_at.toISOString(),
    usedAt: row.used_at?.toISOString() ?? null
  }));
}

export async function listMfaEnrollments(
  principalId: string,
  tenantId: string
): Promise<PrincipalMfaEnrollment[]> {
  if (!sql || !principalId) return [];

  const rows = await sql<
    {
      id: string;
      mfa_type: "TOTP" | "SMS";
      verified_at: Date | null;
      created_at: Date;
      phone_number: string | null;
    }[]
  >`
    SELECT id, mfa_type, verified_at, created_at, phone_number
    FROM mfa_enrollment
    WHERE tenant_id = ${tenantId}
      AND principal_id = ${principalId}
      AND verified_at IS NOT NULL
    ORDER BY verified_at DESC NULLS LAST, created_at DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    mfaType: row.mfa_type,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    phoneNumber: row.phone_number
  }));
}

export async function getTenantMfaSettings(
  tenantId: string
): Promise<TenantMfaSettings> {
  if (!sql) {
    return {
      requireMfa: false,
      mfaGraceDays: 7
    };
  }

  const rows = await sql<{ require_mfa: boolean; mfa_grace_days: number }[]>`
    SELECT require_mfa, mfa_grace_days
    FROM tenant
    WHERE id = ${tenantId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return {
      requireMfa: false,
      mfaGraceDays: 7
    };
  }

  return {
    requireMfa: row.require_mfa,
    mfaGraceDays: row.mfa_grace_days
  };
}

export async function listRevocationHistory(
  tenantId: string,
  workspaceId: string | null,
  limit = 100
): Promise<RevocationRecord[]> {
  if (!sql) return [];

  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      principal_id: string;
      scopes: string[];
      revoked_at: Date;
      created_at: Date;
    }[]>`
      SELECT id, tenant_id, workspace_id, principal_id, scopes, revoked_at, created_at
      FROM service_token
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND revoked_at IS NOT NULL
      ORDER BY revoked_at DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      tokenId: r.id,
      tenantId: r.tenant_id,
      workspaceId: r.workspace_id,
      principalId: r.principal_id,
      scopes: r.scopes ?? [],
      revokedAt: r.revoked_at.toISOString(),
      createdAt: r.created_at.toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function renamePasskey(params: {
  tenantId: string;
  principalId: string;
  passkeyId: string;
  name: string;
}): Promise<boolean> {
  if (!sql || !params.passkeyId || !params.tenantId || !params.principalId) return false;

  const rows = await sql<{ id: string }[]>`
    UPDATE passkey
    SET name = ${params.name.trim().slice(0, 64) || null}
    WHERE id = ${params.passkeyId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
    RETURNING id
  `;

  return rows.length > 0;
}

export async function deletePrincipalPasskey(params: {
  tenantId: string;
  principalId: string;
  passkeyId: string;
}): Promise<boolean> {
  if (!sql || !params.passkeyId || !params.tenantId || !params.principalId) return false;

  const rows = await sql<{ id: string }[]>`
    DELETE FROM passkey
    WHERE id = ${params.passkeyId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
    RETURNING id
  `;

  return rows.length > 0;
}

export async function deletePrincipalMfaEnrollment(params: {
  tenantId: string;
  principalId: string;
  enrollmentId: string;
}): Promise<boolean> {
  if (!sql || !params.enrollmentId || !params.tenantId || !params.principalId) return false;

  const rows = await sql<{ id: string }[]>`
    DELETE FROM mfa_enrollment
    WHERE id = ${params.enrollmentId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
    RETURNING id
  `;

  return rows.length > 0;
}

// Stores the verified COSE public key and initial signature counter from a
// completed registration ceremony. credential_id_b64 is globally unique and a
// credential maps to exactly one principal for life: a first registration
// inserts, and re-registering the *same* credential by its owning principal is
// an idempotent refresh (key material / counter / transports). Re-registering a
// credential already bound to a *different* principal is rejected ("conflict") —
// it must never be silently reassigned to another account.
export async function upsertPasskeyCredential(params: {
  tenantId: string;
  principalId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}): Promise<"ok" | "conflict" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  // The DO UPDATE ... WHERE guard only fires for the owning principal. When the
  // credential belongs to someone else the conflict matches but the WHERE is
  // false, so no row is written and RETURNING yields nothing — surfaced as a
  // conflict rather than a reassignment.
  const rows = await sql<{ id: string }[]>`
    INSERT INTO passkey (
      tenant_id,
      principal_id,
      credential_id_b64,
      public_key_b64,
      counter,
      transports,
      used_at
    ) VALUES (
      ${params.tenantId},
      ${params.principalId},
      ${params.credentialId},
      ${params.publicKey},
      ${params.counter},
      ${params.transports},
      now()
    )
    ON CONFLICT (credential_id_b64) DO UPDATE
    SET
      public_key_b64 = EXCLUDED.public_key_b64,
      counter = EXCLUDED.counter,
      transports = EXCLUDED.transports,
      used_at = now()
    WHERE passkey.principal_id = EXCLUDED.principal_id
    RETURNING id
  `;

  return rows.length > 0 ? "ok" : "conflict";
}

export interface StoredPasskeyCredential {
  tenantId: string;
  principalId: string;
  credentialIdB64: string;
  publicKeyB64: string;
  counter: number;
  transports: string[];
}

// Global lookup by credential ID for usernameless (discoverable) login, before
// any tenant is known. Uses rawSql to bypass RLS (the passkey table is
// tenant-isolated) — the same cross-tenant pre-auth path as upsertSocialPrincipal.
// Tenant and principal are then derived from the verified record, never the client.
export async function getPasskeyByCredentialId(params: {
  credentialId: string;
}): Promise<StoredPasskeyCredential | null> {
  if (!rawSql || !params.credentialId) return null;

  const rows = await rawSql<
    {
      tenant_id: string;
      principal_id: string;
      credential_id_b64: string;
      public_key_b64: string;
      counter: string;
      transports: string[];
    }[]
  >`
    SELECT tenant_id, principal_id, credential_id_b64, public_key_b64, counter, transports
    FROM passkey
    WHERE credential_id_b64 = ${params.credentialId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    credentialIdB64: row.credential_id_b64,
    publicKeyB64: row.public_key_b64,
    counter: Number(row.counter),
    transports: row.transports ?? [],
  };
}

// Persists the post-authentication signature counter and touches used_at.
// Keyed globally by credential ID via rawSql because login runs before a tenant
// context is bound. A regressing/duplicate counter must be rejected by the
// caller (verifyAuthenticationResponse) before this is called.
export async function recordPasskeyAuthentication(params: {
  credentialId: string;
  counter: number;
}): Promise<"ok" | "db-unavailable"> {
  if (!rawSql) return "db-unavailable";

  await rawSql`
    UPDATE passkey
    SET counter = ${params.counter},
        used_at = now()
    WHERE credential_id_b64 = ${params.credentialId}
  `;

  return "ok";
}

export async function createTotpEnrollment(params: {
  tenantId: string;
  principalId: string;
  secret: string;
}): Promise<string | null> {
  if (!sql) return null;
  const key = credentialKey();

  const rows = await sql<{ id: string }[]>`
    INSERT INTO mfa_enrollment (
      tenant_id,
      principal_id,
      mfa_type,
      secret_enc
    ) VALUES (
      ${params.tenantId},
      ${params.principalId},
      'TOTP',
      encode(pgp_sym_encrypt(${params.secret}, ${key}), 'base64')
    )
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export async function getPendingTotpEnrollmentSecret(params: {
  enrollmentId: string;
  tenantId: string;
  principalId: string;
}): Promise<string | null> {
  if (!sql) return null;
  const key = credentialKey();

  const rows = await sql<{ secret_enc: string }[]>`
    SELECT pgp_sym_decrypt(decode(secret_enc, 'base64'), ${key}) AS secret_enc
    FROM mfa_enrollment
    WHERE id = ${params.enrollmentId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND mfa_type = 'TOTP'
      AND verified_at IS NULL
    LIMIT 1
  `;

  return rows[0]?.secret_enc ?? null;
}

export async function markTotpEnrollmentVerified(params: {
  enrollmentId: string;
  tenantId: string;
  principalId: string;
}): Promise<"ok" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  await sql`
    UPDATE mfa_enrollment
    SET verified_at = now()
    WHERE id = ${params.enrollmentId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
  `;

  return "ok";
}

export async function getLatestVerifiedTotpSecret(params: {
  tenantId: string;
  principalId: string;
}): Promise<string | null> {
  if (!sql) return null;
  const key = credentialKey();

  const rows = await sql<{ secret_enc: string }[]>`
    SELECT pgp_sym_decrypt(decode(secret_enc, 'base64'), ${key}) AS secret_enc
    FROM mfa_enrollment
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND mfa_type = 'TOTP'
      AND verified_at IS NOT NULL
    ORDER BY verified_at DESC
    LIMIT 1
  `;

  return rows[0]?.secret_enc ?? null;
}

export async function markSessionMfaVerified(params: {
  sessionId: string;
  tenantId: string;
}): Promise<"ok" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  await sql`
    UPDATE app_session
    SET mfa_verified_at = now(), last_seen_at = now()
    WHERE id = ${params.sessionId}
      AND tenant_id = ${params.tenantId}
      AND revoked_at IS NULL
  `;

  return "ok";
}

export async function setTenantMfaPolicy(params: {
  tenantId: string;
  requireMfa: boolean;
  mfaGraceDays: number;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE tenant SET require_mfa = ${params.requireMfa}, mfa_grace_days = ${params.mfaGraceDays}
    WHERE id = ${params.tenantId}
  `;
}

export async function createSmsEnrollment(params: {
  tenantId: string;
  principalId: string;
  phoneNumber: string;
  secretEnc: string;
}): Promise<string | null> {
  if (!sql) return null;
  const key = credentialKey();

  await sql`
    DELETE FROM mfa_enrollment
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND mfa_type = 'SMS'
      AND verified_at IS NULL
  `;

  const rows = await sql<{ id: string }[]>`
    INSERT INTO mfa_enrollment (
      tenant_id,
      principal_id,
      mfa_type,
      secret_enc,
      phone_number
    ) VALUES (
      ${params.tenantId},
      ${params.principalId},
      'SMS',
      encode(pgp_sym_encrypt(${params.secretEnc}, ${key}), 'base64'),
      ${params.phoneNumber}
    )
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export async function getSmsEnrollment(params: {
  enrollmentId: string;
  tenantId: string;
  principalId: string;
}): Promise<{ secret_enc: string; verified_at: Date | null } | null> {
  if (!sql) return null;
  const key = credentialKey();
  const rows = await sql<{ secret_enc: string; verified_at: Date | null }[]>`
    SELECT pgp_sym_decrypt(decode(secret_enc, 'base64'), ${key}) AS secret_enc, verified_at
    FROM mfa_enrollment
    WHERE id = ${params.enrollmentId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND mfa_type = 'SMS'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function updateSmsEnrollmentSecret(params: {
  enrollmentId: string;
  tenantId: string;
  principalId: string;
  secretEnc: string;
}): Promise<void> {
  if (!sql) return;
  const key = credentialKey();
  await sql`
    UPDATE mfa_enrollment
    SET secret_enc = encode(pgp_sym_encrypt(${params.secretEnc}, ${key}), 'base64')
    WHERE id = ${params.enrollmentId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
  `;
}

export async function markSmsEnrollmentVerified(params: {
  enrollmentId: string;
  tenantId: string;
  principalId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE mfa_enrollment
    SET verified_at = now()
    WHERE id = ${params.enrollmentId}
      AND tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
  `;
}

export async function isSmsCooldownActive(params: {
  principalId: string;
  tenantId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM mfa_enrollment
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND mfa_type = 'SMS'
      AND verified_at IS NULL
      AND created_at > now() - INTERVAL '60 seconds'
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getVerifiedSmsEnrollment(params: {
  tenantId: string;
  principalId: string;
}): Promise<{ id: string; phone_number: string | null; secret_enc: string } | null> {
  if (!sql) return null;
  const key = credentialKey();
  const rows = await sql<{ id: string; phone_number: string | null; secret_enc: string }[]>`
    SELECT id, phone_number, pgp_sym_decrypt(decode(secret_enc, 'base64'), ${key}) AS secret_enc
    FROM mfa_enrollment
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND mfa_type = 'SMS'
      AND verified_at IS NOT NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getVerifiedMfaEnrollments(params: {
  tenantId: string;
  principalId: string;
}): Promise<{ id: string; mfa_type: "TOTP" | "SMS"; secret_enc: string; phone_number: string | null }[]> {
  if (!sql) return [];
  const key = credentialKey();
  return sql<{ id: string; mfa_type: "TOTP" | "SMS"; secret_enc: string; phone_number: string | null }[]>`
    SELECT id, mfa_type, pgp_sym_decrypt(decode(secret_enc, 'base64'), ${key}) AS secret_enc, phone_number
    FROM mfa_enrollment
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND verified_at IS NOT NULL
    ORDER BY verified_at DESC
  `;
}
