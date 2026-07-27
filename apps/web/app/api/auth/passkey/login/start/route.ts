import { NextResponse } from "next/server";
import {
  PASSKEY_LOGIN_CHALLENGE_COOKIE,
  PASSKEY_LOGIN_PRINCIPAL_COOKIE,
  PASSKEY_LOGIN_TENANT_COOKIE,
  authChallengeCookieOptions,
  createChallenge
} from "@/lib/auth-challenge";
import { findUserPrincipalIdByIdentifier } from "@/lib/domains/auth/service";
import { isAuthDatabaseConfigured, resolveTenantIdOrDemo } from "@/lib/domains/auth/service";
import { listPasskeyCredentialIdsForPrincipal } from "@/lib/domains/auth/service";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";

interface PasskeyLoginStartPayload {
  tenantId?: unknown;
  identifier?: unknown;
}

async function handlePostApiAuthPasskeyLoginStart(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  let payload: PasskeyLoginStartPayload;
  try {
    payload = (await request.json()) as PasskeyLoginStartPayload;
  } catch {
    payload = {};
  }

  const tenantId = resolveTenantIdOrDemo(typeof payload.tenantId === "string" ? payload.tenantId : null);
  const identifier = typeof payload.identifier === "string" ? payload.identifier.trim() : "";

  if (!identifier) {
    const response = NextResponse.json({ error: "identifier is required (subject or email).", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const principalId = await findUserPrincipalIdByIdentifier({ tenantId, identifier });
  if (!principalId) {
    const response = NextResponse.json({ error: "No principal matches that identifier.", meta: makeMeta(traceId) }, { status: 404 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const passkeys = await listPasskeyCredentialIdsForPrincipal({ tenantId, principalId });

  if (passkeys.length === 0) {
    const response = NextResponse.json({ error: "No passkeys are enrolled for this account.", meta: makeMeta(traceId) }, { status: 404 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const challenge = createChallenge();
  const response = NextResponse.json({
    challenge,
    allowCredentials: passkeys,
    rpId: process.env.PASSKEY_RP_ID ?? "localhost",
    meta: makeMeta(traceId)
  });
  response.headers.set("x-request-id", traceId);

  response.cookies.set(PASSKEY_LOGIN_CHALLENGE_COOKIE, challenge, authChallengeCookieOptions());
  response.cookies.set(PASSKEY_LOGIN_PRINCIPAL_COOKIE, principalId, authChallengeCookieOptions());
  response.cookies.set(PASSKEY_LOGIN_TENANT_COOKIE, tenantId, authChallengeCookieOptions());

  return response;
}

export { handlePostApiAuthPasskeyLoginStart as POST };
