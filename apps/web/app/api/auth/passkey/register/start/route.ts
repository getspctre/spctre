import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getAuthSession } from "@/lib/auth-session";
import { isAuthDatabaseConfigured, saveWebauthnChallenge } from "@/lib/domains/auth/service";
import { PASSKEY_REG_CHALLENGE_COOKIE, authChallengeCookieOptions } from "@/lib/auth-challenge";
import { getPasskeyRpId, getPasskeyRpName } from "@/lib/webauthn-config";
import { makeMeta, newTraceId } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

const CHALLENGE_TTL_SECONDS = 300;

async function handlePostApiAuthPasskeyRegisterStart() {
  const traceId = newTraceId();
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
      { error: "Passkey registration is not available in Demo Mode.", meta: makeMeta(traceId) },
      { status: 403 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const options = await generateRegistrationOptions({
    rpName: getPasskeyRpName(),
    rpID: getPasskeyRpId(),
    userID: new TextEncoder().encode(session.principalId),
    userName: session.subject,
    userDisplayName: session.subject,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    supportedAlgorithmIDs: [-7, -257],
  });

  // Bind the challenge to this session's principal/tenant, server-side and
  // one-time. The client never chooses the challenge or the tenant.
  const challengeId = await saveWebauthnChallenge({
    purpose: "REGISTRATION",
    challenge: options.challenge,
    principalId: session.principalId,
    tenantId: session.tenantId,
    ttlSeconds: CHALLENGE_TTL_SECONDS,
  });
  if (!challengeId) {
    const response = NextResponse.json(
      { error: "Could not start passkey registration.", meta: makeMeta(traceId) },
      { status: 503 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const response = NextResponse.json({ options, meta: makeMeta(traceId) });
  response.headers.set("x-request-id", traceId);
  response.cookies.set(
    PASSKEY_REG_CHALLENGE_COOKIE,
    challengeId,
    authChallengeCookieOptions(CHALLENGE_TTL_SECONDS),
  );

  return response;
}

export { handlePostApiAuthPasskeyRegisterStart as POST };
