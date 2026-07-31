import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  OIDC_TENANT_COOKIE,
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  getOidcConfig,
  getOidcProviderForTenant,
  oidcCookieOptions
} from "@/lib/enterprise-auth";
import { ACTIVE_TENANT_COOKIE } from "@/lib/workspace/cookies";
import { toBase64Url } from "@/lib/crypto-utils";
import { fetchWithRetry } from "@/lib/platform/fetch-retry";
import { swallow } from "@/lib/platform/swallow";

interface OidcDiscoveryDocument {
  authorization_endpoint: string;
}

async function discover(issuer: string): Promise<OidcDiscoveryDocument> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetchWithRetry(url, { cache: "no-store" });
  if (!res.ok) throw new Error("OIDC discovery failed.");
  const doc = (await res.json()) as Partial<OidcDiscoveryDocument>;
  if (!doc.authorization_endpoint) throw new Error("OIDC discovery document is invalid.");
  return { authorization_endpoint: doc.authorization_endpoint };
}

async function handleGetApiAuthOidcAuthorize(request: NextRequest) {
  const envConfig = getOidcConfig();
  if (!envConfig) {
    return NextResponse.json({ error: "OIDC is not configured." }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const tenantId =
    requestUrl.searchParams.get("tenantId")?.trim() ||
    request.cookies.get(ACTIVE_TENANT_COOKIE)?.value ||
    envConfig.defaultTenantId;

  const provider = await getOidcProviderForTenant(tenantId).catch(swallow("getOidcProviderForTenant", null));
  if (!provider) {
    return NextResponse.json({ error: "No OIDC provider is configured for this tenant." }, { status: 404 });
  }

  let discovery: OidcDiscoveryDocument;
  try {
    discovery = await discover(provider.issuer);
  } catch {
    return NextResponse.json({ error: "Unable to discover OIDC configuration." }, { status: 503 });
  }

  const state = toBase64Url(randomBytes(24));
  const nonce = toBase64Url(randomBytes(24));
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());

  const next = requestUrl.searchParams.get("next")?.trim();
  const safeNext = next && next.startsWith("/") ? next : "/";

  const redirectUrl = new URL(discovery.authorization_endpoint);
  redirectUrl.searchParams.set("response_type", "code");
  redirectUrl.searchParams.set("client_id", provider.clientId);
  redirectUrl.searchParams.set("redirect_uri", provider.redirectUri);
  redirectUrl.searchParams.set("scope", provider.scope);
  redirectUrl.searchParams.set("state", state);
  redirectUrl.searchParams.set("nonce", nonce);
  redirectUrl.searchParams.set("code_challenge", challenge);
  redirectUrl.searchParams.set("code_challenge_method", "S256");
  redirectUrl.searchParams.set("next", safeNext);

  const response = NextResponse.redirect(redirectUrl);
  const maxAge = 60 * 10;
  response.cookies.set(OIDC_STATE_COOKIE, state, oidcCookieOptions(maxAge));
  response.cookies.set(OIDC_NONCE_COOKIE, nonce, oidcCookieOptions(maxAge));
  response.cookies.set(OIDC_VERIFIER_COOKIE, verifier, oidcCookieOptions(maxAge));
  response.cookies.set(OIDC_TENANT_COOKIE, tenantId, oidcCookieOptions(maxAge));

  return response;
}

export { handleGetApiAuthOidcAuthorize as GET };
