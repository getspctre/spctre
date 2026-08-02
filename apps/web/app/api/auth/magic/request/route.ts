import { NextResponse } from "next/server";
import { isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import { findPrincipalByEmail } from "@/lib/domains/auth/service";
import { randomBytes } from "node:crypto";
import { toBase64Url } from "@/lib/crypto-utils";
import { sendMagicLinkEmail } from "@/lib/email";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { logSecurityEvent } from "@/lib/security-logger";
import { swallow } from "@/lib/platform/swallow";
import { getSessionGuardSecret } from "@/lib/session-guard-secret";

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

async function handlePostApiAuthMagicRequest(request: Request) {
  if (!isAuthDatabaseConfigured()) {
    return NextResponse.json({ error: "database_required" }, { status: 503 });
  }

  let secret: string;
  try {
    secret = getSessionGuardSecret();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // 3 requests per email per 15 minutes — checked before principal lookup (no enumeration oracle)
  const rateLimit = await checkAuthRateLimit({
    key: `magic_link:${email}`,
    limit: 3,
    windowSeconds: 900,
  });
  if (!rateLimit.allowed) {
    logSecurityEvent("rate_limited", { endpoint: "/api/auth/magic/request", detail: email });
    return NextResponse.json(
      { error: "Too many magic link requests. Please wait before requesting another." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  logSecurityEvent("magic_link_requested", { endpoint: "/api/auth/magic/request" });

  // Always return success to avoid email enumeration attacks
  const principal = await findPrincipalByEmail(email).catch(swallow("findPrincipalByEmail", null));
  if (principal) {
    const exp = Math.floor(Date.now() / 1000) + 60 * 15; // 15 minutes
    const payloadJson = JSON.stringify({
      principalId: principal.principalId,
      tenantId: principal.tenantId,
      email,
      subject: principal.subject,
      exp,
      jti: randomBytes(16).toString("hex"), // single-use nonce, consumed on verify
    });
    const encodedPayload = toBase64Url(new TextEncoder().encode(payloadJson));
    const sig = await signValue(encodedPayload, secret);
    const token = `${encodedPayload}.${sig}`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
    const magicLink = `${appUrl}/api/auth/magic?token=${encodeURIComponent(token)}&next=/`;

    await sendMagicLinkEmail({ to: email, magicLink }).catch((err: unknown) => {
      console.error("[magic-link] send error:", err);
    });
  }

  return NextResponse.json({ ok: true });
}

export { handlePostApiAuthMagicRequest as POST };
