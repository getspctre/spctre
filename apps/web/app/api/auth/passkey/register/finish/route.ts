import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getAuthSession } from "@/lib/auth-session";
import { PASSKEY_REG_CHALLENGE_COOKIE } from "@/lib/auth-challenge";
import {
  consumeWebauthnChallenge,
  isAuthDatabaseConfigured,
  upsertPasskeyCredential
} from "@/lib/domains/auth/service";
import { getPasskeyExpectedOrigins, getPasskeyRpId } from "@/lib/webauthn-config";
import { toBase64Url } from "@/lib/crypto-utils";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

interface RegisterFinishPayload {
  response?: unknown;
}

async function handlePostApiAuthPasskeyRegisterFinish(request: Request) {
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

  if (isDemoTenant(session.tenantId)) {
    const response = NextResponse.json({ error: "Passkey registration is not available in Demo Mode.", meta: makeMeta(traceId) }, { status: 403 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  let payload: RegisterFinishPayload;
  try {
    payload = (await request.json()) as RegisterFinishPayload;
  } catch {
    const response = NextResponse.json({ error: "Request body must be JSON.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  if (!payload.response || typeof payload.response !== "object") {
    const response = NextResponse.json({ error: "A registration response is required.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  const registrationResponse = payload.response as RegistrationResponseJSON;

  // Consume the one-time challenge and confirm it was issued to this session.
  const cookieStore = await cookies();
  const challengeId = cookieStore.get(PASSKEY_REG_CHALLENGE_COOKIE)?.value ?? "";
  const stored = challengeId
    ? await consumeWebauthnChallenge({ id: challengeId, purpose: "REGISTRATION" })
    : null;
  if (!stored || stored.principalId !== session.principalId || stored.tenantId !== session.tenantId) {
    const response = NextResponse.json({ error: "Invalid or expired passkey challenge.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    response.cookies.delete(PASSKEY_REG_CHALLENGE_COOKIE);
    return response;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: getPasskeyExpectedOrigins(),
      expectedRPID: getPasskeyRpId(),
      requireUserVerification: false
    });
  } catch {
    const response = NextResponse.json({ error: "Passkey attestation could not be verified.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    response.cookies.delete(PASSKEY_REG_CHALLENGE_COOKIE);
    return response;
  }

  if (!verification.verified || !verification.registrationInfo) {
    const response = NextResponse.json({ error: "Passkey attestation could not be verified.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    response.cookies.delete(PASSKEY_REG_CHALLENGE_COOKIE);
    return response;
  }

  // Store the verified credential public key from the authenticator — never a
  // browser-supplied key. credential.id is already base64url; publicKey is the
  // raw COSE key bytes, persisted as base64url.
  const { credential } = verification.registrationInfo;
  const result = await upsertPasskeyCredential({
    tenantId: session.tenantId,
    principalId: session.principalId,
    credentialId: credential.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? []
  });
  if (result === "db-unavailable") {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  if (result === "conflict") {
    // The credential is already registered to a different account; never reassign it.
    const response = NextResponse.json({ error: "This passkey is already registered to another account.", meta: makeMeta(traceId) }, { status: 409 });
    response.headers.set("x-request-id", traceId);
    response.cookies.delete(PASSKEY_REG_CHALLENGE_COOKIE);
    return response;
  }

  const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) }, { status: 201 });
  response.headers.set("x-request-id", traceId);
  response.cookies.delete(PASSKEY_REG_CHALLENGE_COOKIE);
  return response;
}

export { handlePostApiAuthPasskeyRegisterFinish as POST };
