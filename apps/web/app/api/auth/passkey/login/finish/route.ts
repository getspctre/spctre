import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { createAuthSession } from "@/lib/auth-session";
import { PASSKEY_LOGIN_CHALLENGE_COOKIE } from "@/lib/auth-challenge";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import { runWithTenantContext } from "@/lib/tenant-context";
import {
  consumeWebauthnChallenge,
  getPasskeyByCredentialId,
  getPrimaryWorkspaceIdForTenant,
  getPrincipalSubject,
  isAuthDatabaseConfigured,
  recordPasskeyAuthentication
} from "@/lib/domains/auth/service";
import { getPasskeyExpectedOrigins, getPasskeyRpId } from "@/lib/webauthn-config";
import { fromBase64Url } from "@/lib/crypto-utils";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";

interface PasskeyLoginFinishPayload {
  response?: unknown;
}

function jsonError(traceId: string, error: string, status: number, clearCookie = false) {
  const response = NextResponse.json({ error, meta: makeMeta(traceId) }, { status });
  response.headers.set("x-request-id", traceId);
  if (clearCookie) response.cookies.delete(PASSKEY_LOGIN_CHALLENGE_COOKIE);
  return response;
}

async function handlePostApiAuthPasskeyLoginFinish(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    return jsonError(traceId, "Database not configured.", 503);
  }

  let payload: PasskeyLoginFinishPayload;
  try {
    payload = (await request.json()) as PasskeyLoginFinishPayload;
  } catch {
    return jsonError(traceId, "Request body must be JSON.", 400);
  }
  if (!payload.response || typeof payload.response !== "object") {
    return jsonError(traceId, "An authentication response is required.", 400);
  }
  const authResponse = payload.response as AuthenticationResponseJSON;

  // Consume the one-time login challenge bound to this browser.
  const cookieStore = await cookies();
  const challengeId = cookieStore.get(PASSKEY_LOGIN_CHALLENGE_COOKIE)?.value ?? "";
  const stored = challengeId
    ? await consumeWebauthnChallenge({ id: challengeId, purpose: "AUTHENTICATION" })
    : null;
  if (!stored) {
    return jsonError(traceId, "Invalid or expired passkey login challenge.", 400, true);
  }

  // Discoverable login: resolve the credential globally by its ID, then derive
  // the principal and tenant from that verified record — never from the client.
  const credential = await getPasskeyByCredentialId({ credentialId: authResponse.id });
  if (!credential) {
    return jsonError(traceId, "Passkey is not recognized.", 403, true);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: getPasskeyExpectedOrigins(),
      expectedRPID: getPasskeyRpId(),
      credential: {
        id: credential.credentialIdB64,
        publicKey: fromBase64Url(credential.publicKeyB64),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[]
      },
      requireUserVerification: false
    });
  } catch {
    return jsonError(traceId, "Passkey assertion could not be verified.", 403, true);
  }

  if (!verification.verified) {
    return jsonError(traceId, "Passkey assertion could not be verified.", 403, true);
  }

  const { tenantId, principalId } = credential;

  // Advance the signature counter with a compare-and-swap against the value the
  // assertion was verified against (replay/cloning defense). If a concurrent
  // assertion already advanced it, fail closed instead of minting a session.
  const touchResult = await recordPasskeyAuthentication({
    credentialId: credential.credentialIdB64,
    expectedCounter: credential.counter,
    newCounter: verification.authenticationInfo.newCounter
  });
  if (touchResult === "db-unavailable") {
    return jsonError(traceId, "Database not configured.", 503, true);
  }
  if (touchResult === "counter-conflict") {
    return jsonError(traceId, "Passkey assertion could not be verified.", 403, true);
  }

  // Tenant is now trusted; bind context for the principal/workspace/session reads.
  const sessionResult = await runWithTenantContext(tenantId, async () => {
    const subject = await getPrincipalSubject({ tenantId, principalId });
    if (!subject) return null;
    const workspaceId = await getPrimaryWorkspaceIdForTenant(tenantId);
    const sessionId = await createAuthSession({
      principalId,
      tenantId,
      authMethod: "SESSION",
      mfaVerifiedAt: new Date().toISOString()
    });
    return { subject, workspaceId, sessionId };
  });

  if (!sessionResult) {
    return jsonError(traceId, "Principal is not available.", 403, true);
  }

  const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) });
  response.headers.set("x-request-id", traceId);
  await setControlPlaneSessionCookies({
    response,
    sessionId: sessionResult.sessionId,
    tenantId,
    workspaceId: sessionResult.workspaceId ?? "",
    principalId,
    subject: sessionResult.subject,
    mfaVerified: true
  });
  response.cookies.delete(PASSKEY_LOGIN_CHALLENGE_COOKIE);

  return response;
}

export { handlePostApiAuthPasskeyLoginFinish as POST };
