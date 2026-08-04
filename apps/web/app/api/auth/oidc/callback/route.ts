import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import {
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_TENANT_COOKIE,
  OIDC_VERIFIER_COOKIE,
  getOidcConfig,
  getOidcProviderForTenant,
  getOidcProviderByIssuer,
  oidcCookieOptions,
} from "@/lib/enterprise-auth";
import { SESSION_COOKIE, createAuthSession, sessionTtlHours } from "@/lib/auth-session";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/cookies";
import { fetchWithRetry } from "@/lib/platform/fetch-retry";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import { createSessionGuardToken, SESSION_GUARD_COOKIE } from "@/lib/session-guard";
import { ensurePrincipalPermissionGrant } from "@/lib/domains/auth/service";
import { upsertOidcPrincipal, upsertPrincipalExternalIdentity } from "@/lib/domains/auth/service";
import {
  ensureAuthDemoTenant,
  getPrimaryWorkspaceIdForTenant,
  getTenantRequireMfa,
  isAuthDatabaseConfigured,
} from "@/lib/domains/auth/service";
import { swallow } from "@/lib/platform/swallow";

interface OidcDiscoveryDocument {
  token_endpoint: string;
  issuer: string;
  jwks_uri: string;
}

interface OidcTokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
}

interface OidcIdTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  name?: string;
  nonce?: string;
  exp?: number;
}

async function discover(issuer: string): Promise<OidcDiscoveryDocument> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  // Discovery is an idempotent GET; the token exchange below stays
  // single-attempt because the authorization code is single-use.
  const res = await fetchWithRetry(url, { cache: "no-store" });
  if (!res.ok) throw new Error("OIDC discovery failed.");
  const doc = (await res.json()) as Partial<OidcDiscoveryDocument>;
  if (!doc.token_endpoint || !doc.issuer || !doc.jwks_uri)
    throw new Error("OIDC discovery document is invalid.");
  return { token_endpoint: doc.token_endpoint, issuer: doc.issuer, jwks_uri: doc.jwks_uri };
}

function loginRedirect(request: Request, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
}

interface ValidatedOidcCallback {
  code: string;
  safeNext: string;
  nonceCookie: string;
  verifier: string;
  tenantCookie: string | undefined;
}

// Validate config, provider error, code, and CSRF state cookies. Returns the
// parsed callback parameters or an error redirect.
function validateOidcCallback(request: Request): ValidatedOidcCallback | NextResponse {
  if (!isAuthDatabaseConfigured()) {
    return loginRedirect(request, "database_required");
  }

  const callbackUrl = new URL(request.url);
  const error = callbackUrl.searchParams.get("error");
  if (error) {
    return loginRedirect(request, error);
  }

  const code = callbackUrl.searchParams.get("code")?.trim();
  const state = callbackUrl.searchParams.get("state")?.trim();
  const next = callbackUrl.searchParams.get("next")?.trim();
  const safeNext = next && next.startsWith("/") ? next : "/";
  if (!code || !state) {
    return loginRedirect(request, "missing_code");
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }

  const stateCookie = cookies.get(OIDC_STATE_COOKIE) ?? "";
  const nonceCookie = cookies.get(OIDC_NONCE_COOKIE) ?? "";
  const verifier = cookies.get(OIDC_VERIFIER_COOKIE) ?? "";

  if (!stateCookie || !verifier || stateCookie !== state) {
    return loginRedirect(request, "invalid_state");
  }

  return {
    code,
    safeNext,
    nonceCookie,
    verifier,
    tenantCookie: cookies.get(OIDC_TENANT_COOKIE)?.trim(),
  };
}

type OidcProvider = NonNullable<Awaited<ReturnType<typeof getOidcProviderForTenant>>>;

// Resolve the OIDC provider (tenant-scoped when known, else by issuer),
// exchange the code, and verify the ID token including the nonce.
async function resolveOidcClaims(
  request: Request,
  envIssuer: string,
  params: ValidatedOidcCallback,
): Promise<
  | {
      discovery: OidcDiscoveryDocument;
      provider: OidcProvider;
      claims: OidcIdTokenClaims & { sub: string };
    }
  | NextResponse
> {
  const tenantProvider = params.tenantCookie
    ? await getOidcProviderForTenant(params.tenantCookie).catch(
        swallow("getOidcProviderForTenant", null),
      )
    : null;

  let discovery: OidcDiscoveryDocument;
  try {
    discovery = await discover(tenantProvider?.issuer ?? envIssuer);
  } catch {
    return loginRedirect(request, "discovery_failed");
  }

  const provider =
    tenantProvider && tenantProvider.issuer === discovery.issuer
      ? tenantProvider
      : await getOidcProviderByIssuer({
          issuer: discovery.issuer,
          tenantId: params.tenantCookie || undefined,
        }).catch(swallow("getOidcProviderByIssuer", null));
  if (!provider) {
    return loginRedirect(request, "provider_not_configured");
  }

  const tokenRes = await fetchWithTimeout(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: provider.redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code_verifier: params.verifier,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    return loginRedirect(request, "token_exchange_failed");
  }

  const tokenBody = (await tokenRes.json()) as OidcTokenResponse;
  if (!tokenBody.id_token) {
    return loginRedirect(request, "missing_id_token");
  }

  let claims: OidcIdTokenClaims;
  try {
    const JWKS = createRemoteJWKSet(new URL(discovery.jwks_uri));
    const { payload } = await jwtVerify(tokenBody.id_token, JWKS, {
      issuer: discovery.issuer,
      audience: provider.clientId,
    });
    claims = payload as OidcIdTokenClaims;
  } catch {
    return loginRedirect(request, "invalid_id_token");
  }

  if (!claims.sub || !claims.nonce || claims.nonce !== params.nonceCookie) {
    return loginRedirect(request, "invalid_id_token");
  }

  return { discovery, provider, claims: claims as OidcIdTokenClaims & { sub: string } };
}

async function handleGetApiAuthOidcCallback(request: Request) {
  const envConfig = getOidcConfig();
  if (!envConfig) {
    return loginRedirect(request, "oidc_not_configured");
  }

  const validated = validateOidcCallback(request);
  if (validated instanceof NextResponse) return validated;
  const { safeNext } = validated;

  const resolved = await resolveOidcClaims(request, envConfig.issuer, validated);
  if (resolved instanceof NextResponse) return resolved;
  const { discovery, provider, claims } = resolved;

  await ensureAuthDemoTenant();

  const displayName = claims.name?.trim() || claims.email?.trim() || claims.sub;
  const email = claims.email?.trim() || null;
  const tenantId = provider.tenantId;

  const requireMfa = (await getTenantRequireMfa(tenantId)) ?? false;

  const principalId = await upsertOidcPrincipal({
    tenantId,
    subject: claims.sub,
    displayName,
    email,
  });
  if (!principalId) {
    return NextResponse.redirect(new URL("/login?error=database_required", request.url));
  }

  const externalIdentityResult = await upsertPrincipalExternalIdentity({
    principalId,
    tenantId,
    providerId: provider.providerId,
    externalSubject: claims.sub,
    externalEmail: email,
    issuer: discovery.issuer,
  });
  if (externalIdentityResult === "db-unavailable") {
    return NextResponse.redirect(new URL("/login?error=database_required", request.url));
  }

  const grantResult = await ensurePrincipalPermissionGrant({ tenantId, principalId });
  if (grantResult === "db-unavailable") {
    return NextResponse.redirect(new URL("/login?error=database_required", request.url));
  }

  const sessionId = await createAuthSession({
    principalId,
    tenantId,
    authMethod: "OIDC",
    mfaVerifiedAt: requireMfa ? null : new Date().toISOString(),
  });
  const ttlSeconds = sessionTtlHours() * 60 * 60;
  const guardToken = await createSessionGuardToken({
    sid: sessionId,
    tid: tenantId,
    pid: principalId,
    sub: claims.sub,
    mfaVerified: !requireMfa,
    ttlSeconds,
  });

  const workspaceId = await getPrimaryWorkspaceIdForTenant(tenantId);

  const response = NextResponse.redirect(new URL(safeNext, request.url));
  response.cookies.set(SESSION_COOKIE, sessionId, oidcCookieOptions(ttlSeconds));
  response.cookies.set(SESSION_GUARD_COOKIE, guardToken, oidcCookieOptions(ttlSeconds));
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, oidcCookieOptions(ttlSeconds));
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, workspaceId ?? "", oidcCookieOptions(ttlSeconds));

  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_NONCE_COOKIE);
  response.cookies.delete(OIDC_VERIFIER_COOKIE);
  response.cookies.delete(OIDC_TENANT_COOKIE);

  return response;
}

export { handleGetApiAuthOidcCallback as GET };
