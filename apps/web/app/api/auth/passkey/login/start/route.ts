import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { PASSKEY_LOGIN_CHALLENGE_COOKIE, authChallengeCookieOptions } from "@/lib/auth-challenge";
import { isAuthDatabaseConfigured, saveWebauthnChallenge } from "@/lib/domains/auth/service";
import { getPasskeyRpId } from "@/lib/webauthn-config";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";

const CHALLENGE_TTL_SECONDS = 300;

// Usernameless (discoverable) login: no email, tenant, or allowCredentials. The
// authenticator selects the resident passkey; the server derives the principal
// and tenant from the verified credential at finish. This avoids trusting any
// client-supplied identity before an assertion is verified.
async function handlePostApiAuthPasskeyLoginStart(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json(
      { error: "Database not configured.", meta: makeMeta(traceId) },
      { status: 503 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const options = await generateAuthenticationOptions({
    rpID: getPasskeyRpId(),
    allowCredentials: [],
    userVerification: "preferred",
  });

  const challengeId = await saveWebauthnChallenge({
    purpose: "AUTHENTICATION",
    challenge: options.challenge,
    ttlSeconds: CHALLENGE_TTL_SECONDS,
  });
  if (!challengeId) {
    const response = NextResponse.json(
      { error: "Could not start passkey login.", meta: makeMeta(traceId) },
      { status: 503 },
    );
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const response = NextResponse.json({ options, meta: makeMeta(traceId) });
  response.headers.set("x-request-id", traceId);
  response.cookies.set(
    PASSKEY_LOGIN_CHALLENGE_COOKIE,
    challengeId,
    authChallengeCookieOptions(CHALLENGE_TTL_SECONDS),
  );

  return response;
}

export { handlePostApiAuthPasskeyLoginStart as POST };
