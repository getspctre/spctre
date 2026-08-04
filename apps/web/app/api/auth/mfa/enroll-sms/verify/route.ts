import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { verifyFirebasePhoneAuth } from "@/lib/platform/sms";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import {
  getPrimaryWorkspaceIdForTenant,
  isAuthDatabaseConfigured,
} from "@/lib/domains/auth/service";
import {
  markSessionMfaVerified,
  getSmsEnrollment,
  updateSmsEnrollmentSecret,
  markSmsEnrollmentVerified,
  deletePrincipalMfaEnrollment,
} from "@/lib/domains/auth/service";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

interface EnrollSmsVerifyPayload {
  enrollmentId?: unknown;
  code?: unknown;
}

async function handlePostApiAuthMfaEnrollSmsVerify(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json(
      { error: "Database not configured.", meta: makeMeta(traceId) },
      { status: 503 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  // Commercial gate
  if (getSpctrePlan() === "oss") {
    const response = NextResponse.json(
      { error: "SMS MFA is only available on Commercial / Cloud tiers.", meta: makeMeta(traceId) },
      { status: 403 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    const response = NextResponse.json(
      { error: "Authentication required.", meta: makeMeta(traceId) },
      { status: 401 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  if (isDemoTenant(session.tenantId)) {
    const response = NextResponse.json(
      { error: "SMS enrollment is not available in Demo Mode.", meta: makeMeta(traceId) },
      { status: 403 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  let payload: EnrollSmsVerifyPayload;
  try {
    payload = (await request.json()) as EnrollSmsVerifyPayload;
  } catch {
    const response = NextResponse.json(
      { error: "Request body must be JSON.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const enrollmentId = typeof payload.enrollmentId === "string" ? payload.enrollmentId.trim() : "";
  const code = typeof payload.code === "string" ? payload.code.trim() : "";

  if (!enrollmentId || !/^\d{6}$/.test(code)) {
    const response = NextResponse.json(
      { error: "enrollmentId and a valid 6-digit code are required.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  // Retrieve pending SMS enrollment using repository helper
  const enrollment = await getSmsEnrollment({
    enrollmentId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  if (!enrollment) {
    const response = NextResponse.json(
      { error: "SMS MFA enrollment not found.", meta: makeMeta(traceId) },
      { status: 404 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  if (enrollment.verified_at) {
    const response = NextResponse.json(
      { error: "This SMS MFA enrollment is already verified.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  let state: { sessionInfo: string; expiresAt: string; attempts: number };
  try {
    state = JSON.parse(enrollment.secret_enc);
  } catch {
    const response = NextResponse.json(
      { error: "Invalid enrollment state.", meta: makeMeta(traceId) },
      { status: 500 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  // Check expiration
  if (new Date() > new Date(state.expiresAt)) {
    await deletePrincipalMfaEnrollment({
      enrollmentId,
      tenantId: session.tenantId,
      principalId: session.principalId,
    });
    const response = NextResponse.json(
      { error: "Verification code has expired. Please try again.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  // Check brute force attempts
  if (state.attempts >= 3) {
    await deletePrincipalMfaEnrollment({
      enrollmentId,
      tenantId: session.tenantId,
      principalId: session.principalId,
    });
    const response = NextResponse.json(
      { error: "Too many incorrect attempts. Enrollment restarted.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  // Verify OTP code
  let isValid = false;
  if (state.sessionInfo) {
    isValid = await verifyFirebasePhoneAuth(state.sessionInfo, code);
  }

  if (!isValid) {
    const nextAttempts = state.attempts + 1;
    if (nextAttempts >= 3) {
      await deletePrincipalMfaEnrollment({
        enrollmentId,
        tenantId: session.tenantId,
        principalId: session.principalId,
      });
      const response = NextResponse.json(
        { error: "Too many incorrect attempts. Enrollment restarted.", meta: makeMeta(traceId) },
        { status: 400 },
      );
      response.headers.set("x-request-id", traceId);
      return response;
    } else {
      const nextSecretEnc = JSON.stringify({ ...state, attempts: nextAttempts });
      await updateSmsEnrollmentSecret({
        enrollmentId,
        tenantId: session.tenantId,
        principalId: session.principalId,
        secretEnc: nextSecretEnc,
      });
      const response = NextResponse.json(
        { error: "Invalid verification code.", meta: makeMeta(traceId) },
        { status: 400 },
      );
      response.headers.set("x-request-id", traceId);
      return response;
    }
  }

  // Mark verified using repository helpers
  await markSmsEnrollmentVerified({
    enrollmentId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  await markSessionMfaVerified({ sessionId: session.sessionId, tenantId: session.tenantId });

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
    mfaVerified: true,
  });

  return response;
}

export { handlePostApiAuthMfaEnrollSmsVerify as POST };
