import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  finalizeOAuthCallback,
  loginRedirect,
  validateOAuthCallback,
  type OAuthCallbackValidation,
  type OAuthIdentity,
} from "@/lib/domains/auth/oauth-callback";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";

const STATE_COOKIE = "spctre_google_state";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

interface GoogleTokenResponse {
  id_token?: string;
  access_token?: string;
}

interface GoogleIdTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
}

// Exchange the OAuth code and verify the ID token, requiring a verified email.
async function resolveGoogleIdentity(
  request: Request,
  params: { code: string; clientId: string; clientSecret: string }
): Promise<OAuthIdentity | NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const tokenRes = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    return loginRedirect(request, "token_exchange_failed");
  }

  const tokenBody = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokenBody.id_token) {
    return loginRedirect(request, "missing_id_token");
  }

  const claims = await jwtVerify(tokenBody.id_token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: params.clientId,
  })
    .then(({ payload }) => payload as GoogleIdTokenClaims)
    .catch(() => null);
  const subject = typeof claims?.sub === "string" ? claims.sub : "";
  const email = typeof claims?.email === "string" ? claims.email : "";
  const displayName = typeof claims?.name === "string" ? claims.name.trim() : "";
  if (!subject || !email || claims?.email_verified !== true) {
    return loginRedirect(request, "invalid_id_token");
  }

  return {
    provider: "GOOGLE",
    subject,
    email,
    displayName: displayName || email,
  };
}

async function handleGetApiAuthGoogleCallback(request: Request) {
  const validated = validateOAuthCallback(request, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    notConfiguredError: "google_not_configured",
    stateCookie: STATE_COOKIE,
  });
  if (validated instanceof NextResponse) return validated;
  const { safeNext } = validated;

  const identity = await resolveGoogleIdentity(request, validated satisfies OAuthCallbackValidation);
  if (identity instanceof NextResponse) return identity;

  return finalizeOAuthCallback({
    request,
    identity,
    stateCookie: STATE_COOKIE,
    logPrefix: "[google-callback]",
    safeNext,
  });
}

export { handleGetApiAuthGoogleCallback as GET };
