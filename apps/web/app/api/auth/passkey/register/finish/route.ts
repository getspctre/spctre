import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { PASSKEY_REG_CHALLENGE_COOKIE } from "@/lib/auth-challenge";
import { isAuthDatabaseConfigured } from "@/lib/domains/auth/service";
import { upsertPasskeyCredential } from "@/lib/domains/auth/service";
import { extractTraceId, makeMeta } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";

interface RegisterFinishPayload {
  challenge?: unknown;
  credentialId?: unknown;
  publicKey?: unknown;
  transports?: unknown;
}

async function handlePostApiAuthPasskeyRegisterFinish(request: Request) {
  const traceId = extractTraceId(request);
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

  let payload: RegisterFinishPayload;
  try {
    payload = (await request.json()) as RegisterFinishPayload;
  } catch {
    const response = NextResponse.json({ error: "Request body must be JSON.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const challenge = typeof payload.challenge === "string" ? payload.challenge.trim() : "";
  const credentialId = typeof payload.credentialId === "string" ? payload.credentialId.trim() : "";
  const publicKey = typeof payload.publicKey === "string" ? payload.publicKey.trim() : "";
  const transports = Array.isArray(payload.transports)
    ? payload.transports.filter((value): value is string => typeof value === "string")
    : [];

  if (!challenge || !credentialId || !publicKey) {
    const response = NextResponse.json({ error: "challenge, credentialId, and publicKey are required.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(PASSKEY_REG_CHALLENGE_COOKIE)?.value ?? "";
  if (!expectedChallenge || challenge !== expectedChallenge) {
    const response = NextResponse.json({ error: "Invalid passkey challenge.", meta: makeMeta(traceId) }, { status: 400 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const result = await upsertPasskeyCredential({
    tenantId: session.tenantId,
    principalId: session.principalId,
    credentialId,
    publicKey,
    transports,
  });
  if (result === "db-unavailable") {
    const response = NextResponse.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 });
    response.headers.set("x-request-id", traceId);
    return response;
  }

  const response = NextResponse.json({ ok: true, meta: makeMeta(traceId) }, { status: 201 });
  response.headers.set("x-request-id", traceId);
  response.cookies.delete(PASSKEY_REG_CHALLENGE_COOKIE);
  return response;
}

export { handlePostApiAuthPasskeyRegisterFinish as POST };
