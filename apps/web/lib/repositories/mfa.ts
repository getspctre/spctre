import { sql } from "@/lib/db";

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

export async function upsertPasskeyCredential(params: {
  tenantId: string;
  principalId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
}): Promise<"ok" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  await sql`
    INSERT INTO passkey (
      tenant_id,
      principal_id,
      credential_id_b64,
      public_key_b64,
      transports,
      used_at
    ) VALUES (
      ${params.tenantId},
      ${params.principalId},
      ${params.credentialId},
      ${params.publicKey},
      ${params.transports},
      now()
    )
    ON CONFLICT (tenant_id, credential_id_b64) DO UPDATE
    SET
      principal_id = EXCLUDED.principal_id,
      public_key_b64 = EXCLUDED.public_key_b64,
      transports = EXCLUDED.transports,
      used_at = now()
  `;

  return "ok";
}

export async function listPasskeyCredentialIdsForPrincipal(params: {
  tenantId: string;
  principalId: string;
}): Promise<string[]> {
  if (!sql) return [];

  const rows = await sql<{ credential_id_b64: string }[]>`
    SELECT credential_id_b64
    FROM passkey
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
    ORDER BY created_at ASC
  `;

  return rows.map((row) => row.credential_id_b64);
}

export async function isPasskeyCredentialEnrolled(params: {
  tenantId: string;
  principalId: string;
  credentialId: string;
}): Promise<boolean | null> {
  if (!sql) return null;

  const rows = await sql<{ credential_id_b64: string }[]>`
    SELECT credential_id_b64
    FROM passkey
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND credential_id_b64 = ${params.credentialId}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function markPasskeyUsed(params: {
  tenantId: string;
  principalId: string;
  credentialId: string;
}): Promise<"ok" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  await sql`
    UPDATE passkey
    SET used_at = now()
    WHERE tenant_id = ${params.tenantId}
      AND principal_id = ${params.principalId}
      AND credential_id_b64 = ${params.credentialId}
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
