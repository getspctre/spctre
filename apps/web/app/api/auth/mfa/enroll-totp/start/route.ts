import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { generateTotpSecret } from "@/lib/totp";
import { isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import { createTotpEnrollment } from "@/lib/domains/auth/service";
import { makeMeta, newTraceId } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";

async function handlePostApiAuthMfaEnrollTotpStart() {
  const traceId = newTraceId();
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const session = await getAuthSession().catch(() => null);
  if (!session) {
    const response = NextResponse.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  if (isDemoTenant(session.tenantId)) {
    const response = NextResponse.json({ error: "TOTP enrollment is not available in Demo Mode.", meta: makeMeta(traceId) }, { status: 403 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const secret = generateTotpSecret();
  const enrollmentId = await createTotpEnrollment({
    tenantId: session.tenantId,
    principalId: session.principalId,
    secret,
  });
  if (!enrollmentId) {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  const label = encodeURIComponent(`spctre:${session.email ?? session.subject}`);
  const issuer = encodeURIComponent("Spctre");
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&period=30&digits=6`;

  const response = NextResponse.json(
    { enrollmentId, secret, otpauthUrl, meta: makeMeta(traceId) },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
  response.headers.set("x-request-id", traceId);
  return response;
}

export { handlePostApiAuthMfaEnrollTotpStart as POST };
