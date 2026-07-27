import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import {
  PASSKEY_REG_CHALLENGE_COOKIE,
  authChallengeCookieOptions,
  createChallenge
} from "@/lib/auth-challenge";
import { makeMeta, newTraceId } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";

async function handlePostApiAuthPasskeyRegisterStart() {
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
    const response = NextResponse.json({ error: "Passkey registration is not available in Demo Mode.", meta: makeMeta(traceId) }, { status: 403 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const challenge = createChallenge();
  const response = NextResponse.json({
    challenge,
    rpId: process.env.PASSKEY_RP_ID ?? "localhost",
    rpName: process.env.PASSKEY_RP_NAME ?? "Spctre Control Plane",
    meta: makeMeta(traceId)
  });
  response.headers.set("x-request-id", traceId);
  response.cookies.set(PASSKEY_REG_CHALLENGE_COOKIE, challenge, authChallengeCookieOptions());

  return response;
}

export { handlePostApiAuthPasskeyRegisterStart as POST };
