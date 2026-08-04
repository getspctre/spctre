import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import {
  getVerifiedSmsEnrollment,
  isSmsCooldownActive,
  updateSmsEnrollmentSecret,
} from "@/lib/domains/auth/service";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { sendSmsOtp } from "@/lib/platform/sms";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";
import { errorText } from "@/lib/error-message";
import { swallow } from "@/lib/platform/swallow";

async function handlePostApiAuthMfaSmsSendOtp(request: Request) {
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

  let payload: { recaptchaToken?: unknown } = {};
  try {
    payload = await request.json().catch(() => ({}));
  } catch {}

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

  // Retrieve verified SMS enrollment using repository helper
  const enrollment = await getVerifiedSmsEnrollment({
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  if (!enrollment) {
    const response = NextResponse.json(
      { error: "No verified SMS MFA enrollment found.", meta: makeMeta(traceId) },
      { status: 404 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

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

  try {
    const state = JSON.parse(enrollment.secret_enc) as { sentAt?: unknown };
    const sentAt = typeof state.sentAt === "string" ? new Date(state.sentAt) : null;
    if (sentAt && Number.isFinite(sentAt.getTime()) && Date.now() - sentAt.getTime() < 60_000) {
      const response = NextResponse.json(
        { error: "Please wait before requesting another SMS code.", meta: makeMeta(traceId) },
        { status: 429 },
      );
      response.headers.set("x-request-id", traceId);
      return response;
    }
  } catch {}

  let sessionInfo: string;
  try {
    sessionInfo = await sendSmsOtp(enrollment.phone_number ?? "", effectiveRecaptchaToken);
  } catch (err) {
    const response = NextResponse.json(
      { error: errorText(err) || "Failed to send SMS.", meta: makeMeta(traceId) },
      { status: 502 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
  const secretEnc = JSON.stringify({
    sessionInfo,
    expiresAt,
    attempts: 0,
    sentAt: new Date().toISOString(),
  });

  // Update secret_enc with the active code using repository helper
  await updateSmsEnrollmentSecret({
    enrollmentId: enrollment.id,
    tenantId: session.tenantId,
    principalId: session.principalId,
    secretEnc,
  });

  const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) });
  response.headers.set("x-request-id", traceId);
  return response;
}

export { handlePostApiAuthMfaSmsSendOtp as POST };
