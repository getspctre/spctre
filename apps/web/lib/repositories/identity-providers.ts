import { sql } from "@/lib/db";

export interface IdentityProviderSummary {
  id: string;
  providerType: "OIDC" | "SAML";
  name: string;
  issuer: string;
  clientId: string | null;
  metadataUrl: string | null;
  scope: string | null;
  samlEntryPoint: string | null;
  samlCert: string | null;
  createdAt: string;
}

interface OidcProviderRow {
  id: string;
  tenant_id: string;
  issuer: string;
  client_id: string;
  client_secret_enc: string | null;
  scope: string | null;
}

interface SamlProviderRow {
  id: string;
  tenant_id: string;
  issuer: string;
  saml_entry_point: string | null;
  saml_cert: string | null;
}

function credentialKey(): string {
  const key = process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set.");
  return key;
}

export async function listIdentityProviders(
  tenantId: string
): Promise<IdentityProviderSummary[]> {
  if (!sql) return [];

  const rows = await sql<
    {
      id: string;
      provider_type: "OIDC" | "SAML";
      name: string;
      issuer: string;
      client_id: string | null;
      metadata_url: string | null;
      scope: string | null;
      saml_entry_point: string | null;
      saml_cert: string | null;
      created_at: Date;
    }[]
  >`
    SELECT
      id,
      provider_type,
      name,
      issuer,
      client_id,
      metadata_url,
      scope,
      saml_entry_point,
      saml_cert,
      created_at
    FROM identity_provider
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    providerType: row.provider_type,
    name: row.name,
    issuer: row.issuer,
    clientId: row.client_id,
    metadataUrl: row.metadata_url,
    scope: row.scope,
    samlEntryPoint: row.saml_entry_point,
    samlCert: row.saml_cert,
    createdAt: row.created_at.toISOString()
  }));
}

export async function upsertDefaultOidcProvider(params: {
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}): Promise<void> {
  if (!sql) return;
  const key = credentialKey();
  await sql`
    INSERT INTO identity_provider (
      tenant_id,
      provider_type,
      name,
      issuer,
      client_id,
      client_secret_enc,
      scope
    ) VALUES (
      ${params.tenantId},
      'OIDC',
      'Default OIDC Provider',
      ${params.issuer},
      ${params.clientId},
      encode(pgp_sym_encrypt(${params.clientSecret}, ${key}), 'base64'),
      ${params.scope}
    )
    ON CONFLICT (tenant_id, provider_type, issuer) DO UPDATE
    SET
      client_id = EXCLUDED.client_id,
      client_secret_enc = EXCLUDED.client_secret_enc,
      scope = EXCLUDED.scope
  `;
}

export async function findOidcProviderForTenant(
  tenantId: string
): Promise<OidcProviderRow | null> {
  if (!sql) return null;
  const key = credentialKey();
  const rows = await sql<OidcProviderRow[]>`
    SELECT id, tenant_id, issuer, client_id, pgp_sym_decrypt(decode(client_secret_enc, 'base64'), ${key}) AS client_secret_enc, scope
    FROM identity_provider
    WHERE tenant_id = ${tenantId}
      AND provider_type = 'OIDC'
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findOidcProviderByIssuer(params: {
  issuer: string;
}): Promise<OidcProviderRow | null> {
  if (!sql) return null;
  const key = credentialKey();
  const rows = await sql<OidcProviderRow[]>`
    SELECT id, tenant_id, issuer, client_id, pgp_sym_decrypt(decode(client_secret_enc, 'base64'), ${key}) AS client_secret_enc, scope
    FROM identity_provider
    WHERE provider_type = 'OIDC'
      AND issuer = ${params.issuer}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findSamlProviderForTenant(
  tenantId: string
): Promise<SamlProviderRow | null> {
  if (!sql) return null;
  const rows = await sql<SamlProviderRow[]>`
    SELECT id, tenant_id, issuer, saml_entry_point, saml_cert
    FROM identity_provider
    WHERE tenant_id = ${tenantId}
      AND provider_type = 'SAML'
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function upsertSamlIdentityProvider(params: {
  tenantId: string;
  providerId: string;
  name: string;
  issuer: string;
  samlEntryPoint: string;
  samlCert: string | null;
  updateCert: boolean;
}): Promise<void> {
  if (!sql) return;
  if (params.providerId) {
    await sql`
      UPDATE identity_provider
      SET provider_type = 'SAML', name = ${params.name}, issuer = ${params.issuer},
          saml_entry_point = ${params.samlEntryPoint},
          saml_cert = CASE WHEN ${params.updateCert} THEN ${params.samlCert} ELSE saml_cert END
      WHERE id = ${params.providerId} AND tenant_id = ${params.tenantId}
    `;
  } else {
    await sql`
      INSERT INTO identity_provider (tenant_id, provider_type, name, issuer, client_id, saml_entry_point, saml_cert)
      VALUES (${params.tenantId}, 'SAML', ${params.name}, ${params.issuer}, null, ${params.samlEntryPoint}, ${params.samlCert})
      ON CONFLICT (tenant_id, provider_type, issuer) DO UPDATE SET
        name = EXCLUDED.name, saml_entry_point = EXCLUDED.saml_entry_point,
        saml_cert = COALESCE(EXCLUDED.saml_cert, identity_provider.saml_cert)
    `;
  }
  await sql`UPDATE tenant SET saml_enabled = true WHERE id = ${params.tenantId}`;
}

export async function upsertOidcIdentityProvider(params: {
  tenantId: string;
  providerId: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  metadataUrl: string | null;
  scope: string;
  updateSecret: boolean;
}): Promise<void> {
  if (!sql) return;
  const key = credentialKey();
  if (params.providerId) {
    await sql`
      UPDATE identity_provider
      SET provider_type = 'OIDC', name = ${params.name}, issuer = ${params.issuer},
          client_id = ${params.clientId},
          client_secret_enc = CASE
            WHEN ${params.updateSecret} AND ${params.clientSecret} IS NOT NULL
            THEN encode(pgp_sym_encrypt(${params.clientSecret}, ${key}), 'base64')
            ELSE client_secret_enc
          END,
          metadata_url = ${params.metadataUrl}, scope = ${params.scope}
      WHERE id = ${params.providerId} AND tenant_id = ${params.tenantId}
    `;
  } else {
    await sql`
      INSERT INTO identity_provider (tenant_id, provider_type, name, issuer, client_id, client_secret_enc, metadata_url, scope)
      VALUES (
        ${params.tenantId}, 'OIDC', ${params.name}, ${params.issuer}, ${params.clientId},
        CASE
          WHEN ${params.clientSecret} IS NOT NULL THEN encode(pgp_sym_encrypt(${params.clientSecret}, ${key}), 'base64')
          ELSE NULL
        END,
        ${params.metadataUrl}, ${params.scope}
      )
      ON CONFLICT (tenant_id, provider_type, issuer) DO UPDATE SET
        name = EXCLUDED.name, client_id = EXCLUDED.client_id,
        client_secret_enc = COALESCE(EXCLUDED.client_secret_enc, identity_provider.client_secret_enc),
        metadata_url = EXCLUDED.metadata_url, scope = EXCLUDED.scope
    `;
  }
  await sql`UPDATE tenant SET oidc_enabled = true WHERE id = ${params.tenantId}`;
}

export async function deleteIdentityProviderById(params: {
  tenantId: string;
  providerId: string;
}): Promise<string | null> {
  if (!sql) return null;
  const providerRows = await sql<{ provider_type: string }[]>`
    SELECT provider_type FROM identity_provider
    WHERE id = ${params.providerId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  await sql`DELETE FROM identity_provider WHERE id = ${params.providerId} AND tenant_id = ${params.tenantId}`;
  return providerRows[0]?.provider_type ?? null;
}

export async function countIdentityProvidersByType(params: {
  tenantId: string;
  providerType: string;
}): Promise<number> {
  if (!sql) return 0;
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM identity_provider
    WHERE tenant_id = ${params.tenantId} AND provider_type = ${params.providerType}
  `;
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

export async function setTenantAuthFlag(params: {
  tenantId: string;
  flag: "saml_enabled" | "oidc_enabled";
  value: boolean;
}): Promise<void> {
  if (!sql) return;
  if (params.flag === "saml_enabled") {
    await sql`UPDATE tenant SET saml_enabled = ${params.value} WHERE id = ${params.tenantId}`;
  } else {
    await sql`UPDATE tenant SET oidc_enabled = ${params.value} WHERE id = ${params.tenantId}`;
  }
}
