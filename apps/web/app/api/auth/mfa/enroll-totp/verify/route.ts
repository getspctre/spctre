import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { verifyTotpCode } from "@/lib/totp";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import {
  getPrimaryWorkspaceIdForTenant,
  isAuthDatabaseConfigured,
} from "@/lib/domains/auth/service";
import {
  getPendingTotpEnrollmentSecret,
  markSessionMfaVerified,
  markTotpEnrollmentVerified,
} from "@/lib/domains/auth/service";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

interface EnrollVerifyPayload {
  enrollmentId?: unknown;
  code?: unknown;
}

async function handlePostApiAuthMfaEnrollTotpVerify(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json(
      { error: "Database not configured.", meta: makeMeta(traceId) },
      { status: 503 },
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
      { error: "TOTP enrollment is not available in Demo Mode.", meta: makeMeta(traceId) },
      { status: 403 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  let payload: EnrollVerifyPayload;
  try {
    payload = (await request.json()) as EnrollVerifyPayload;
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

  const secret = await getPendingTotpEnrollmentSecret({
    enrollmentId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });
  if (!secret) {
    const response = NextResponse.json(
      { error: "MFA enrollment was not found.", meta: makeMeta(traceId) },
      { status: 404 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  if (!verifyTotpCode({ code, secretBase32: secret })) {
    const response = NextResponse.json(
      { error: "Invalid MFA code.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const verifyResult = await markTotpEnrollmentVerified({
    enrollmentId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });
  if (verifyResult === "db-unavailable") {
    const response = NextResponse.json(
      { error: "Database not configured.", meta: makeMeta(traceId) },
      { status: 503 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const sessionResult = await markSessionMfaVerified({
    sessionId: session.sessionId,
    tenantId: session.tenantId,
  });
  if (sessionResult === "db-unavailable") {
    const response = NextResponse.json(
      { error: "Database not configured.", meta: makeMeta(traceId) },
      { status: 503 },
    );
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
    mfaVerified: true,
  });

  return response;
}

export { handlePostApiAuthMfaEnrollTotpVerify as POST };
