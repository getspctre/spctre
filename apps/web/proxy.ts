import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_GUARD_COOKIE, verifySessionGuardToken } from "@/lib/session-guard";

const SESSION_COOKIE = "spctre_session_id";
const DOCS_HOST = process.env.SPCTRE_DOCS_HOST || "docs.spctre.dev";
const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/api/auth/oidc/authorize",
  "/api/auth/oidc/callback",
  "/icon.svg",
  "/favicon.ico",
  "/llms.txt",
  "/llms-full.txt",
]);
const PUBLIC_PATH_PREFIXES = ["/login/", "/signup/"];
const SERVICE_API_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/evidence",
  "/api/v1/evidence",
  "/api/bundle/latest",
  "/api/v1/bundle/latest",
  "/api/compliance/export",
  "/api/v1/compliance/export",
  "/api/gateway/decide",
  "/api/v1/gateway/decide",
  "/api/gateway/escalations",
  "/api/v1/gateway/escalations",
  "/api/gateway/escalations/status",
  "/api/v1/gateway/escalations/status",
  "/api/verification",
  "/api/v1/verification",
  "/api/v1/openapi.json",
  "/api/compliance/seal",
  "/api/token/refresh",
  "/api/v1/token/refresh",
  "/api/token/revoke",
  "/api/v1/token/revoke",
  "/api/search",
]);
const SERVICE_API_PATH_PREFIXES = [
  "/api/e2e/",
  "/api/scim/v2/",
  "/api/v1/scim/v2/",
  "/api/gateway-ingest/",
  "/api/agents/",
  "/api/onboarding/cli/",
];

function isDocsHost(request: NextRequest): boolean {
  const forwardedHost = firstForwardedHeaderValue(request.headers.get("x-forwarded-host"));
  const host = (forwardedHost ?? request.headers.get("host") ?? "").toLowerCase();
  // Strip port suffix (e.g. "docs.spctre.dev:443") before comparing.
  return host.replace(/:\d+$/, "") === DOCS_HOST;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || hasAnyPrefix(pathname, PUBLIC_PATH_PREFIXES);
}

function isServiceApiPath(pathname: string): boolean {
  // These endpoints authenticate via bearer token or are pre-auth bootstrap paths.
  return SERVICE_API_PATHS.has(pathname) || hasAnyPrefix(pathname, SERVICE_API_PATH_PREFIXES);
}

function isAuthApiPath(pathname: string): boolean {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function hasAnyPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

function hasBearerToken(request: NextRequest): boolean {
  return (request.headers.get("authorization") ?? "").startsWith("Bearer ");
}

function isSameOriginBrowserMutation(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expectedOrigins = getExpectedOrigins(request);

  if (origin) return expectedOrigins.has(origin);
  if (referer) {
    try {
      return expectedOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  return false;
}

function firstForwardedHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function getExpectedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([request.nextUrl.origin]);

  // Explicitly configured app URLs are also trusted, for deployments where
  // the app is reached through a public URL that differs from the request
  // host (e.g. behind a CDN or reverse proxy).
  for (const raw of [process.env.SPCTRE_APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // ignore malformed config
    }
  }

  const forwardedHost = firstForwardedHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? request.headers.get("host");
  if (!host) return origins;

  const forwardedProto = firstForwardedHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto ?? request.nextUrl.protocol.replace(/:$/, "");
  origins.add(`${protocol}://${host}`);
  return origins;
}

function parseAllowedSourceIps(): Set<string> {
  return new Set(
    (process.env.SPCTRE_ALLOWED_SOURCE_IPS ?? "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean)
  );
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

function isHealthPath(pathname: string): boolean {
  return pathname === "/api/health" || pathname === "/api/ready";
}

// Paddle delivers webhooks from its own fleet, whose source IPs are not a
// stable customer-controlled allowlist. This one endpoint authenticates every
// request with Paddle's HMAC signature before doing any billing work.
function isPaddleWebhookRequest(request: NextRequest): boolean {
  return request.method === "POST" && request.nextUrl.pathname === "/api/billing/paddle/webhook";
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const devConnectSources = isDev ? " ws: wss:" : "";
  return [
    "default-src 'self'",
    // www.gstatic.com + www.google.com — reCAPTCHA scripts loaded by Firebase RecaptchaVerifier
    `script-src 'self' 'nonce-${nonce}' https://www.gstatic.com https://www.google.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://cdn.simpleicons.org https://logo.clearbit.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // reCAPTCHA v2/v3 renders an iframe hosted on google.com
    "frame-src https://www.google.com https://recaptcha.google.com",
    // Firebase Auth + reCAPTCHA v2/v3/Enterprise API calls made from the browser
    `connect-src 'self'${devConnectSources} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://recaptchaenterprise.googleapis.com https://www.google.com`,
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, csp?: string): NextResponse {
  if (csp) response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return response;
}

function passThrough(request: NextRequest, nonce: string): NextResponse {
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js derives script nonces from the request-side CSP header; the response
  // header is what the browser enforces. Both must carry the same value.
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, csp);
}

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function getPositiveIntegerEnv(name: string, defaultValue: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const rateLimitMaxRequests = getPositiveIntegerEnv("SPCTRE_RATE_LIMIT_MAX_REQUESTS", 100);
const rateLimitWindowSeconds = getPositiveIntegerEnv("SPCTRE_RATE_LIMIT_WINDOW_SECONDS", 60);
const rateLimitWindowMs = rateLimitWindowSeconds * 1000;

// Fallback in-memory rate limiter for OSS / no-Redis environments.
// Per-instance only: on multi-instance deployments the effective global limit
// is N x the configured limit and resets on every scale event. Global rate
// limiting requires the Upstash binding (UPSTASH_REDIS_REST_URL/TOKEN).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkMemoryRateLimit(ip: string, limit: number, windowMs: number): { success: boolean; reset: number } {
  if (rateLimitMap.size > 10000) {
    const now = Date.now();
    for (const [key, value] of rateLimitMap.entries()) {
      if (now > value.resetAt) {
        rateLimitMap.delete(key);
      }
    }
  }

  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    const resetAt = now + windowMs;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { success: true, reset: resetAt };
  }
  if (record.count >= limit) {
    return { success: false, reset: record.resetAt };
  }
  record.count += 1;
  return { success: true, reset: record.resetAt };
}

function rateLimitedResponse(reset: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests." },
    {
      status: 429,
      headers: {
        "Retry-After": retryAfter.toString()
      }
    }
  );
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let upstashRatelimit: Ratelimit | null = null;
if (upstashUrl && upstashToken) {
  upstashRatelimit = new Ratelimit({
    redis: new Redis({ url: upstashUrl, token: upstashToken }),
    limiter: Ratelimit.slidingWindow(rateLimitMaxRequests, `${rateLimitWindowSeconds} s`),
    analytics: false,
  });
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();

  if (!process.env.DATABASE_URL) {
    return passThrough(request, nonce);
  }

  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);
  const allowedSourceIps = parseAllowedSourceIps();

  if (
    allowedSourceIps.size > 0 &&
    !isHealthPath(pathname) &&
    !isPaddleWebhookRequest(request) &&
    !allowedSourceIps.has(ip)
  ) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (
    isUnsafeMethod(request.method) &&
    !hasBearerToken(request) &&
    Boolean(request.cookies.get(SESSION_COOKIE)?.value) &&
    !isSameOriginBrowserMutation(request)
  ) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  // docs.spctre.dev — rewrite root-relative paths to /help-docs/* and bypass session auth.
  // API paths (e.g. /api/search used by Orama) pass through without rewriting.
  if (isDocsHost(request)) {
    const { pathname } = request.nextUrl;
    if (isApiPath(pathname)) {
      return passThrough(request, nonce);
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/help-docs" : "/help-docs" + pathname;
    const csp = buildCsp(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    requestHeaders.set("x-is-docs", "true");
    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    return applySecurityHeaders(response, csp);
  }

  // Apply rate limiting to API and Auth routes
  if (isApiPath(pathname) || isAuthApiPath(pathname) || isServiceApiPath(pathname)) {
    if (upstashRatelimit) {
      const { success, reset } = await upstashRatelimit.limit(ip);
      if (!success) {
        return rateLimitedResponse(reset);
      }
    } else {
      const { success, reset } = checkMemoryRateLimit(ip, rateLimitMaxRequests, rateLimitWindowMs);
      if (!success) {
        return rateLimitedResponse(reset);
      }
    }
  }

  if (pathname === "/api-docs") {
    return NextResponse.next();
  }

  if (pathname === "/help-docs" || pathname.startsWith("/help-docs/")) {
    const csp = buildCsp(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    requestHeaders.set("x-is-docs", "true");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return applySecurityHeaders(response, csp);
  }

  if (isPublicPath(pathname) || isServiceApiPath(pathname) || isAuthApiPath(pathname)) {
    return passThrough(request, nonce);
  }

  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionGuard = request.cookies.get(SESSION_GUARD_COOKIE)?.value;
  if (sessionId && sessionGuard) {
    const guardClaims = await verifySessionGuardToken(sessionGuard, sessionId);
    if (guardClaims) {
      if (!guardClaims.mfa) {
        if (isApiPath(pathname)) {
          return NextResponse.json({ error: "MFA verification required." }, { status: 403 });
        }

        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("mfa", "required");
        loginUrl.searchParams.set("next", pathname);
        return NextResponse.redirect(loginUrl);
      }
      return passThrough(request, nonce);
    }
  }

  if (!sessionId && !sessionGuard) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = isApiPath(pathname)
    ? NextResponse.json({ error: "Invalid or expired session." }, { status: 401 })
    : (() => {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", pathname);
        return NextResponse.redirect(loginUrl);
      })();
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(SESSION_GUARD_COOKIE);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|icon.svg).*)"]
};
