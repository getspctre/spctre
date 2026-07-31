import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { verifyFirebasePhoneAuth } from "@/lib/platform/sms";
import { verifyTotpCode } from "@/lib/totp";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import { getPrimaryWorkspaceIdForTenant, isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import {
  getLatestVerifiedTotpSecret,
  markSessionMfaVerified,
  getVerifiedMfaEnrollments,
  updateSmsEnrollmentSecret,
} from "@/lib/domains/auth/service";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { logSecurityEvent } from "@/lib/security-logger";
import { swallow } from "@/lib/platform/swallow";

interface MfaVerifyPayload {
  code?: unknown;
  // "totp" | "sms" — required when both methods are enrolled.
  // Omitting is valid for single-enrolled accounts (backward compat).
  method?: unknown;
}

type MfaSession = { tenantId: string; principalId: string };
type MfaEnrollments = Awaited<ReturnType<typeof getVerifiedMfaEnrollments>>;

// Phase 2: SMS verification with per-enrollment attempt tracking. Every wrong
// code increments the attempt counter — the caller has declared SMS intent.
async function verifySmsCode(
  enrollments: MfaEnrollments,
  code: string,
  session: MfaSession
): Promise<boolean> {
  for (const enrollment of enrollments) {
    if (enrollment.mfa_type !== "SMS") continue;

    let state: { sessionInfo: string; expiresAt: string; attempts: number };
    try {
      state = JSON.parse(enrollment.secret_enc);
    } catch {
      continue;
    }

    if (new Date() > new Date(state.expiresAt)) continue;
    if (!state.sessionInfo || state.attempts >= 3) continue;

    const isValid = await verifyFirebasePhoneAuth(state.sessionInfo, code);

    if (isValid) {
      await updateSmsEnrollmentSecret({
        enrollmentId: enrollment.id,
        tenantId: session.tenantId,
        principalId: session.principalId,
        secretEnc: JSON.stringify({ ...state, sessionInfo: "" }),
      });
      return true;
    }
    await updateSmsEnrollmentSecret({
      enrollmentId: enrollment.id,
      tenantId: session.tenantId,
      principalId: session.principalId,
      secretEnc: JSON.stringify({ ...state, attempts: state.attempts + 1 }),
    });
  }
  return false;
}

// Parse and validate the request body into a code + declared factor.
async function parseMfaPayload(
  request: Request
): Promise<{ code: string; factor: "totp" | "sms" | null } | { error: string }> {
  let payload: MfaVerifyPayload;
  try {
    payload = (await request.json()) as MfaVerifyPayload;
  } catch {
    return { error: "Request body must be JSON." };
  }

  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return { error: "A valid 6-digit MFA code is required." };
  }

  const rawMethod = typeof payload.method === "string" ? payload.method.toLowerCase() : null;
  const factor: "totp" | "sms" | null =
    rawMethod === "totp" ? "totp" : rawMethod === "sms" ? "sms" : null;

  return { code, factor };
}

async function handlePostApiAuthMfaVerify(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    const response = NextResponse.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  if (!session.requireMfa) {
    const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const parsed = await parseMfaPayload(request);
  if ("error" in parsed) {
    const response = NextResponse.json({ error: parsed.error, meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  const { code, factor } = parsed;

  // 10 wrong attempts per session per 5 minutes
  const rateLimit = await checkAuthRateLimit({
    key: `mfa_verify:${session.sessionId}`,
    limit: 10,
    windowSeconds: 300,
  });
  if (!rateLimit.allowed) {
    logSecurityEvent("rate_limited", {
      tenantId: session.tenantId,
      principalId: session.principalId,
      sessionId: session.sessionId,
      endpoint: "/api/auth/mfa/verify",
    });
    const response = NextResponse.json(
      { error: "Too many MFA attempts. Please wait.", meta: makeMeta(traceId) },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const enrollments = await getVerifiedMfaEnrollments({
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  if (!enrollments.length) {
    const response = NextResponse.json({ error: "No verified MFA enrollment found.", meta: makeMeta(traceId) }, { status: 404 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const hasTotpEnrollment = enrollments.some((e) => e.mfa_type === "TOTP");

  let verified = false;

  // Phase 1: TOTP — skipped only when client explicitly declares method:"sms".
  if (factor !== "sms") {
    for (const enrollment of enrollments) {
      if (enrollment.mfa_type !== "TOTP") continue;
      if (verifyTotpCode({ code, secretBase32: enrollment.secret_enc })) {
        verified = true;
        break;
      }
    }
  }

  // Phase 2: SMS.
  // Run when:
  //   - client declared method:"sms" (dual-enrolled user explicitly picking SMS), OR
  //   - no method given and no TOTP enrollment exists (pure-SMS backward compat).
  // Attempt counter is always incremented on a miss here: the client has declared
  // SMS intent (or is a pure-SMS user), so every wrong code is a genuine SMS guess.
  const shouldTrySms = factor === "sms" || (factor === null && !hasTotpEnrollment);

  if (!verified && shouldTrySms) {
    const { getSpctrePlan } = await import("@/lib/feature-flags-server");
    if (getSpctrePlan() !== "oss") {
      verified = await verifySmsCode(enrollments, code, session);
    }
  }

  if (!verified) {
    logSecurityEvent("mfa_failed", {
      tenantId: session.tenantId,
      principalId: session.principalId,
      sessionId: session.sessionId,
      endpoint: "/api/auth/mfa/verify",
    });
    const response = NextResponse.json({ error: "Invalid MFA code.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  logSecurityEvent("mfa_verified", {
    tenantId: session.tenantId,
    principalId: session.principalId,
    sessionId: session.sessionId,
    endpoint: "/api/auth/mfa/verify",
  });

  const sessionResult = await markSessionMfaVerified({
    sessionId: session.sessionId,
    tenantId: session.tenantId,
  });
  if (sessionResult === "db-unavailable") {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const workspaceId = await getPrimaryWorkspaceIdForTenant(session.tenantId);

  const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) });
  response.headers.set("x-request-id", traceId);
  await setControlPlaneSessionCookies({
    response,
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    workspaceId: workspaceId ?? "",

    principalId: session.principalId,
    subject: session.subject,
    mfaVerified: true
  });

  return response;
}

export { handlePostApiAuthMfaVerify as POST };
