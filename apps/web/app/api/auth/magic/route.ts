import { NextResponse } from "next/server";
import { createAuthSession } from "@/lib/auth-session";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import { getPrimaryWorkspaceIdForTenant, getPrincipalForLogin, isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import { fromBase64Url, toBase64Url } from "@/lib/crypto-utils";

// Helper to get session guard secret matching next.js standard
function getSessionGuardSecret(): string {
  const configured = process.env.SPCTRE_SESSION_GUARD_SECRET?.trim();
  if (configured) return configured;

  // Keep local development usable without extra setup.
  if (process.env.NODE_ENV !== "production") {
    return "spctre-dev-session-guard-secret";
  }

  return "";
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(sig));
}

function getRequestBase(request: Request): string {
  // Prefer an explicit server-side URL — immune to header manipulation.
  const appUrl = process.env.SPCTRE_APP_URL?.trim().replace(/\/$/, "");
  if (appUrl) return appUrl;

  // NEXT_PUBLIC_APP_URL is already used by magic-link generation (request/route.ts)
  // and every other auth callback (Google, GitHub). Using it here keeps the redirect
  // origin consistent with the link origin without needing a separate server-side var.
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (publicAppUrl) return publicAppUrl;

  // Last resort: derive from forwarded headers. Only safe when the edge/proxy
  // strips or overwrites x-forwarded-host before requests reach Next.js.
  // Set NEXT_PUBLIC_APP_URL or SPCTRE_APP_URL in production to avoid this path.
  // Multi-hop proxies set "X-Forwarded-Host: downstream, upstream" — take only
  // the first segment to prevent open-redirect via a crafted comma-separated value.
  const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const host = rawHost.split(",")[0].trim();
  const rawProto = request.headers.get("x-forwarded-proto") || "";
  const protocol = rawProto.split(",")[0].trim() || (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${protocol}://${host}`;
}

/**
 * Normalise a user-supplied `next` redirect path to a safe same-origin path.
 *
 * startsWith("/") alone accepts protocol-relative URLs such as //evil.com/path,
 * which new URL(safeNext, base) then resolves to an external origin.
 * Instead, parse the value against a throwaway base: if the parsed hostname is
 * no longer that placeholder the input contained an authority component (absolute
 * URL, protocol-relative URL, or a javascript: URI) and must be rejected.
 */
function safeRedirectPath(next: string | null | undefined): string {
  if (!next) return "/";
  try {
    const parsed = new URL(next, "https://placeholder.invalid");
    if (parsed.hostname !== "placeholder.invalid") return "/";
    return parsed.pathname + parsed.search + parsed.hash || "/";
  } catch {
    return "/";
  }
}

interface MagicTokenPayload {
  principalId: string;
  tenantId: string;
  email: string;
  subject: string;
  exp: number;
  jti: string;
}

// Verify the signed magic-link token's format, signature, expiry, and jti.
// Returns the payload, or the login error code to redirect with.
async function validateMagicToken(token: string, secret: string): Promise<MagicTokenPayload | { error: string }> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { error: "invalid_token_format" };
  }

  const [encodedPayload, encodedSig] = parts;
  const expectedSig = await signValue(encodedPayload, secret);
  const expectedBytes = fromBase64Url(expectedSig);
  const actualBytes = fromBase64Url(encodedSig);

  if (!timingSafeEqual(expectedBytes, actualBytes)) {
    return { error: "invalid_token_signature" };
  }

  let payload: MagicTokenPayload;
  try {
    const payloadJson = new TextDecoder().decode(fromBase64Url(encodedPayload));
    payload = JSON.parse(payloadJson);
  } catch {
    return { error: "invalid_token_payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    return { error: "token_expired" };
  }

  if (!payload.jti || typeof payload.jti !== "string") {
    return { error: "invalid_token_payload" };
  }

  return payload;
}

async function handleGetApiAuthMagic(request: Request) {
  const base = getRequestBase(request);

  if (!isAuthDatabaseConfigured()) {
    return NextResponse.redirect(new URL("/login?error=database_required", base));
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const nextParam = url.searchParams.get("next")?.trim();
  const safeNext = safeRedirectPath(nextParam);

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", base));
  }

  const secret = getSessionGuardSecret();
  if (!secret) {
    return NextResponse.redirect(new URL("/login?error=sso_not_configured", base));
  }

  const payload = await validateMagicToken(token, secret);
  if ("error" in payload) {
    return NextResponse.redirect(new URL(`/login?error=${payload.error}`, base));
  }

  // A magic link is validated before the browser has a tenant-bound session.
  // Use the audited owner connection for these bootstrap reads so RLS cannot
  // hide the signed principal or its initial workspace.
  const { rawSql } = await import("@/lib/db");
  if (!rawSql) {
    return NextResponse.redirect(new URL("/login?error=database_required", base));
  }

  const principal = await getPrincipalForLogin(payload.principalId, rawSql);
  if (!principal) {
    return NextResponse.redirect(new URL("/login?error=principal_not_found", base));
  }

  if (principal.disabled_at) {
    return NextResponse.redirect(new URL("/login?error=principal_disabled", base));
  }

  // Enforce single use: the first request to present this jti wins; any replay
  // (including concurrent requests) hits the primary-key conflict and is refused.
  const consumed = await rawSql<{ jti: string }[]>`
    INSERT INTO consumed_magic_link (jti, principal_id, expires_at)
    VALUES (${payload.jti}, ${principal.id}, to_timestamp(${payload.exp}))
    ON CONFLICT (jti) DO NOTHING
    RETURNING jti
  `.catch(() => [] as { jti: string }[]);
  if (consumed.length === 0) {
    return NextResponse.redirect(new URL("/login?error=token_already_used", base));
  }

  const sessionId = await createAuthSession({
    principalId: principal.id,
    tenantId: principal.tenant_id,
    authMethod: "SESSION",
    mfaVerifiedAt: principal.require_mfa ? null : new Date().toISOString(),
    db: rawSql,
  });

  const workspaceId = await getPrimaryWorkspaceIdForTenant(principal.tenant_id, rawSql);

  const response = NextResponse.redirect(new URL(safeNext, base));
  await setControlPlaneSessionCookies({
    response,
    sessionId,
    tenantId: principal.tenant_id,
    workspaceId: workspaceId ?? "",
    principalId: principal.id,
    subject: principal.subject,
    mfaVerified: !principal.require_mfa
  });

  return response;
}

export { handleGetApiAuthMagic as GET };
