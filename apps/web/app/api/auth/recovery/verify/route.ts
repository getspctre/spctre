import { NextResponse } from "next/server";
import { isAuthDatabaseConfigured, getPrimaryWorkspaceIdForTenant } from "@/lib/domains/auth/service";
import { findPrincipalByEmail, consumeRecoveryCode } from "@/lib/domains/auth/service";
import { createAuthSession } from "@/lib/auth-session";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import { getPrincipalForLogin } from "@/lib/domains/auth/service";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { logSecurityEvent } from "@/lib/security-logger";

async function handlePostApiAuthRecoveryVerify(request: Request) {
  if (!isAuthDatabaseConfigured()) {
    return NextResponse.json({ error: "database_required" }, { status: 503 });
  }

  let email: string;
  let code: string;
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!email || !code) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // 5 attempts per email per 10 minutes — checked before principal lookup to avoid timing oracle
  const rateLimit = await checkAuthRateLimit({
    key: `recovery_verify:${email}`,
    limit: 5,
    windowSeconds: 600,
  });
  if (!rateLimit.allowed) {
    logSecurityEvent("rate_limited", { endpoint: "/api/auth/recovery/verify", detail: email });
    return NextResponse.json(
      { error: "Too many recovery attempts. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const principal = await findPrincipalByEmail(email).catch(() => null);
  if (!principal) {
    // Constant-time response to avoid email enumeration
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  const consumed = await consumeRecoveryCode({
    principalId: principal.principalId,
    tenantId: principal.tenantId,
    code,
  });

  if (!consumed) {
    logSecurityEvent("recovery_code_failed", {
      tenantId: principal.tenantId,
      principalId: principal.principalId,
      endpoint: "/api/auth/recovery/verify",
    });
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  logSecurityEvent("recovery_code_used", {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    endpoint: "/api/auth/recovery/verify",
  });

  // Delete all existing MFA enrollments to force re-enrollment
  const { rawSql } = await import("@/lib/db");
  if (rawSql) {
    await rawSql`
      DELETE FROM mfa_enrollment
      WHERE principal_id = ${principal.principalId}
        AND tenant_id = ${principal.tenantId}
    `;
  }

  const loginPrincipal = await getPrincipalForLogin(principal.principalId).catch(() => null);
  if (!loginPrincipal || loginPrincipal.disabled_at) {
    return NextResponse.json({ error: "principal_unavailable" }, { status: 403 });
  }

  const sessionId = await createAuthSession({
    principalId: principal.principalId,
    tenantId: principal.tenantId,
    authMethod: "SESSION",
    mfaVerifiedAt: new Date().toISOString(),
  });

  const workspaceId = (await getPrimaryWorkspaceIdForTenant(principal.tenantId)) ?? "";
  const response = NextResponse.json({ ok: true });

  await setControlPlaneSessionCookies({
    response,
    sessionId,
    tenantId: principal.tenantId,
    workspaceId,
    principalId: principal.principalId,
    subject: principal.subject,
    mfaVerified: true,
  });

  return response;
}

export { handlePostApiAuthRecoveryVerify as POST };
