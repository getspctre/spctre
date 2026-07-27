import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthSession } from "@/lib/auth-session";
import {
  PASSKEY_LOGIN_CHALLENGE_COOKIE,
  PASSKEY_LOGIN_PRINCIPAL_COOKIE,
  PASSKEY_LOGIN_TENANT_COOKIE
} from "@/lib/auth-challenge";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import { getPrincipalSubject } from "@/lib/domains/auth/service";
import { getPrimaryWorkspaceIdForTenant, isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import { isPasskeyCredentialEnrolled, markPasskeyUsed } from "@/lib/domains/auth/service";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";

interface PasskeyLoginFinishPayload {
  challenge?: unknown;
  credentialId?: unknown;
}

// Parse the finish payload and match it against the login-challenge cookies.
async function parsePasskeyFinishRequest(request: Request): Promise<
  | { credentialId: string; principalId: string; tenantId: string }
  | { error: string }
> {
  let payload: PasskeyLoginFinishPayload;
  try {
    payload = (await request.json()) as PasskeyLoginFinishPayload;
  } catch {
    return { error: "Request body must be JSON." };
  }

  const challenge = typeof payload.challenge === "string" ? payload.challenge.trim() : "";
  const credentialId = typeof payload.credentialId === "string" ? payload.credentialId.trim() : "";
  if (!challenge || !credentialId) {
    return { error: "challenge and credentialId are required." };
  }

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(PASSKEY_LOGIN_CHALLENGE_COOKIE)?.value ?? "";
  const principalId = cookieStore.get(PASSKEY_LOGIN_PRINCIPAL_COOKIE)?.value ?? "";
  const tenantId = cookieStore.get(PASSKEY_LOGIN_TENANT_COOKIE)?.value ?? "";

  if (!expectedChallenge || challenge !== expectedChallenge || !principalId || !tenantId) {
    return { error: "Invalid passkey login challenge." };
  }

  return { credentialId, principalId, tenantId };
}

async function handlePostApiAuthPasskeyLoginFinish(request: Request) {
  const traceId = extractTraceId(request);
  if (!isAuthDatabaseConfigured()) {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const parsed = await parsePasskeyFinishRequest(request);
  if ("error" in parsed) {
    const response = NextResponse.json({ error: parsed.error, meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  const { credentialId, principalId, tenantId } = parsed;

  const enrolled = await isPasskeyCredentialEnrolled({ tenantId, principalId, credentialId });
  if (enrolled === null) {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  if (!enrolled) {
    const response = NextResponse.json({ error: "Passkey credential is not enrolled for this account.", meta: makeMeta(traceId) }, { status: 403 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const subject = await getPrincipalSubject({ tenantId, principalId });
  if (!subject) {
    const response = NextResponse.json({ error: "Principal is not available.", meta: makeMeta(traceId) }, { status: 403 });
    response.headers.set("x-request-id", traceId);
    return response;
  }
  const workspaceId = await getPrimaryWorkspaceIdForTenant(tenantId);

  const sessionId = await createAuthSession({
    principalId,
    tenantId,
    authMethod: "SESSION",
    mfaVerifiedAt: new Date().toISOString()
  });

  const touchResult = await markPasskeyUsed({ tenantId, principalId, credentialId });
  if (touchResult === "db-unavailable") {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) });
  response.headers.set("x-request-id", traceId);
  await setControlPlaneSessionCookies({
    response,
    sessionId,
    tenantId,
    workspaceId: workspaceId ?? "",

    principalId,
    subject,
    mfaVerified: true
  });

  response.cookies.delete(PASSKEY_LOGIN_CHALLENGE_COOKIE);
  response.cookies.delete(PASSKEY_LOGIN_PRINCIPAL_COOKIE);
  response.cookies.delete(PASSKEY_LOGIN_TENANT_COOKIE);

  return response;
}

export { handlePostApiAuthPasskeyLoginFinish as POST };
