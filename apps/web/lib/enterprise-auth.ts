import { DEMO_TENANT_ID } from "@/lib/demo";
import { ensureAuthDemoTenant } from "@/lib/repositories/auth/session";
import {
  findOidcProviderByIssuer as findOidcProviderByIssuerRow,
  findOidcProviderForTenant as findOidcProviderForTenantRow,
  findSamlProviderForTenant as findSamlProviderForTenantRow,
  upsertDefaultOidcProvider,
} from "@/lib/repositories/identity-providers";

export const OIDC_STATE_COOKIE = "spctre_oidc_state";
export const OIDC_VERIFIER_COOKIE = "spctre_oidc_verifier";
export const OIDC_NONCE_COOKIE = "spctre_oidc_nonce";
export const OIDC_TENANT_COOKIE = "spctre_oidc_tenant";

const DEFAULT_OIDC_SCOPE = "openid profile email";

export interface OidcEnvConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  defaultTenantId: string;
}

export interface OidcProviderConfig {
  providerId: string;
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

export function getOidcConfig(): OidcEnvConfig | null {
  const enabled = (process.env.OIDC_ENABLED ?? "").toLowerCase() === "true";
  if (!enabled) return null;

  const issuer = (process.env.OIDC_PROVIDER_ISSUER ?? "").trim();
  const clientId = (process.env.OIDC_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.OIDC_CLIENT_SECRET ?? "").trim();
  const redirectUri = (process.env.OIDC_REDIRECT_URI ?? "").trim();
  const scope = (process.env.OIDC_SCOPES ?? DEFAULT_OIDC_SCOPE).trim();
  const defaultTenantId = (process.env.OIDC_DEFAULT_TENANT_ID ?? DEMO_TENANT_ID).trim();

  if (!issuer || !clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    scope,
    defaultTenantId
  };
}

async function bootstrapDefaultProvider(tenantId: string): Promise<void> {
  const env = getOidcConfig();
  if (!env) return;
  if (tenantId !== env.defaultTenantId) return;

  await ensureAuthDemoTenant().catch(() => {});
  await upsertDefaultOidcProvider({
    tenantId,
    issuer: env.issuer,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    scope: env.scope,
  }).catch(() => {});
}

export async function getOidcProviderForTenant(tenantId: string): Promise<OidcProviderConfig | null> {
  await bootstrapDefaultProvider(tenantId).catch(() => {});

  const row = await findOidcProviderForTenantRow(tenantId).catch(() => null);
  const env = getOidcConfig();
  if (!row || !row.client_secret_enc || !env?.redirectUri) return null;

  return {
    providerId: row.id,
    tenantId: row.tenant_id,
    issuer: row.issuer,
    clientId: row.client_id,
    clientSecret: row.client_secret_enc,
    redirectUri: env.redirectUri,
    scope: row.scope?.trim() || env.scope || DEFAULT_OIDC_SCOPE
  };
}

export async function getOidcProviderByIssuer(params: {
  issuer: string;
  tenantId?: string;
}): Promise<OidcProviderConfig | null> {
  if (params.tenantId) {
    const preferred = await getOidcProviderForTenant(params.tenantId).catch(() => null);
    if (preferred?.issuer === params.issuer) return preferred;
  }

  const row = await findOidcProviderByIssuerRow({ issuer: params.issuer }).catch(() => null);
  const env = getOidcConfig();
  if (!row || !row.client_secret_enc || !env?.redirectUri) return null;

  return {
    providerId: row.id,
    tenantId: row.tenant_id,
    issuer: row.issuer,
    clientId: row.client_id,
    clientSecret: row.client_secret_enc,
    redirectUri: env.redirectUri,
    scope: row.scope?.trim() || env.scope || DEFAULT_OIDC_SCOPE
  };
}

export function oidcCookieOptions(maxAgeSeconds: number) {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds
  };
}

/** @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/) */
export const SAML_TENANT_COOKIE = "spctre_saml_tenant";

export interface SamlEnvConfig {
  spEntityId: string;
  acsUrl: string;
}

export interface SamlProviderConfig {
  providerId: string;
  tenantId: string;
  entryPoint: string;
  cert: string;
  idpIssuer: string;
}

export function getSamlConfig(): SamlEnvConfig | null {
  const enabled = (process.env.SAML_ENABLED ?? "").toLowerCase() === "true";
  if (!enabled) return null;

  const spEntityId = (process.env.SAML_SP_ENTITY_ID ?? "").trim();
  const acsUrl = (process.env.SAML_ACS_URL ?? "").trim();

  if (!spEntityId || !acsUrl) return null;

  return { spEntityId, acsUrl };
}

export async function getSamlProviderForTenant(
  tenantId: string
): Promise<SamlProviderConfig | null> {
  const row = await findSamlProviderForTenantRow(tenantId).catch(() => null);
  if (!row || !row.saml_entry_point || !row.saml_cert) return null;

  return {
    providerId: row.id,
    tenantId: row.tenant_id,
    entryPoint: row.saml_entry_point,
    cert: row.saml_cert,
    idpIssuer: row.issuer
  };
}

/** @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/) */
export function samlCookieOptions(maxAgeSeconds: number) {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds
  };
}
