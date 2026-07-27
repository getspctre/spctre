import { toBase64Url, fromBase64Url } from "@/lib/crypto-utils";

export const SESSION_GUARD_COOKIE = "spctre_session_guard";

interface SessionGuardClaims {
  sid: string;
  tid: string;
  pid: string;
  sub: string;
  mfa: boolean;
  exp: number;
}

function getSessionGuardSecret(): string | null {
  const configured = process.env.SPCTRE_SESSION_GUARD_SECRET?.trim();
  if (configured) return configured;

  // Keep local development usable without extra setup.
  if (process.env.NODE_ENV !== "production") {
    return "spctre-dev-session-guard-secret";
  }

  return null;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(sig));
}

export async function createSessionGuardToken(params: {
  sid: string;
  tid: string;
  pid: string;
  sub: string;
  mfaVerified: boolean;
  ttlSeconds: number;
}): Promise<string> {
  const secret = getSessionGuardSecret();
  if (!secret) {
    throw new Error("SPCTRE_SESSION_GUARD_SECRET is required in production.");
  }

  const exp = Math.floor(Date.now() / 1000) + Math.max(1, params.ttlSeconds);
  const payload: SessionGuardClaims = {
    sid: params.sid,
    tid: params.tid,
    pid: params.pid,
    sub: params.sub,
    mfa: params.mfaVerified,
    exp
  };

  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${sig}`;
}

export async function verifySessionGuardToken(
  token: string,
  expectedSessionId?: string
): Promise<SessionGuardClaims | null> {
  const secret = getSessionGuardSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [encodedPayload, encodedSig] = parts;
  const expectedSig = await signValue(encodedPayload, secret);
  const expectedBytes = fromBase64Url(expectedSig);
  const actualBytes = fromBase64Url(encodedSig);
  if (!timingSafeEqual(expectedBytes, actualBytes)) return null;

  let payload: SessionGuardClaims;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionGuardClaims;
  } catch {
    return null;
  }

  if (
    typeof payload.sid !== "string" ||
    typeof payload.tid !== "string" ||
    typeof payload.pid !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.mfa !== "boolean" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (expectedSessionId && payload.sid !== expectedSessionId) return null;

  return payload;
}
