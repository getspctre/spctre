import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import { createSmsEnrollment, isSmsCooldownActive } from "@/lib/domains/auth/service";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { sendSmsOtp } from "@/lib/platform/sms";
import { makeMeta, newTraceId } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";
import { errorText } from "@/lib/error-message";
import { swallow } from "@/lib/platform/swallow";

interface EnrollSmsStartPayload {
  phoneNumber?: unknown;
  recaptchaToken?: unknown;
}

async function handlePostApiAuthMfaEnrollSmsStart(request: Request) {
  const traceId = newTraceId();
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

  let payload: EnrollSmsStartPayload;
  try {
    payload = (await request.json()) as EnrollSmsStartPayload;
  } catch {
    const response = NextResponse.json(
      { error: "Request body must be JSON.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const phoneNumber = typeof payload.phoneNumber === "string" ? payload.phoneNumber.trim() : "";
  if (!phoneNumber || !/^\+?[1-9]\d{1,14}$/.test(phoneNumber)) {
    const response = NextResponse.json(
      { error: "A valid phone number in E.164 format is required.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const recaptchaToken =
    typeof payload.recaptchaToken === "string" ? payload.recaptchaToken.trim() : "";
  if (!recaptchaToken && process.env.NODE_ENV === "production") {
    const response = NextResponse.json(
      { error: "reCAPTCHA token is required.", meta: makeMeta(traceId) },
      { status: 400 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }
  const effectiveRecaptchaToken = recaptchaToken || "mock-server-token";

  // Per-principal SMS send rate limit (60-second cooldown)
  const cooldown = await isSmsCooldownActive({
    principalId: session.principalId,
    tenantId: session.tenantId,
  });
  if (cooldown) {
    const response = NextResponse.json(
      { error: "Please wait before requesting another SMS code.", meta: makeMeta(traceId) },
      { status: 429 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  // Dispatch to Firebase, which returns a sessionInfo token
  let sessionInfo: string;
  try {
    sessionInfo = await sendSmsOtp(phoneNumber, effectiveRecaptchaToken);
  } catch (err) {
    const response = NextResponse.json(
      { error: errorText(err) || "Failed to send SMS.", meta: makeMeta(traceId) },
      { status: 502 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes expiry
  const secretEnc = JSON.stringify({
    sessionInfo,
    expiresAt,
    attempts: 0,
    sentAt: new Date().toISOString(),
  });

  // Create pending SMS enrollment using repository helper
  const enrollmentId = await createSmsEnrollment({
    tenantId: session.tenantId,
    principalId: session.principalId,
    phoneNumber,
    secretEnc,
  });

  if (!enrollmentId) {
    const response = NextResponse.json(
      { error: "Database save failed.", meta: makeMeta(traceId) },
      { status: 500 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const response = NextResponse.json({ enrollmentId, meta: makeMeta(traceId) }, { status: 201 });
  response.headers.set("x-request-id", traceId);
  return response;
}

export { handlePostApiAuthMfaEnrollSmsStart as POST };
