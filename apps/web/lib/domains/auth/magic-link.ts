import { randomBytes } from "node:crypto";
import { toBase64Url } from "@/lib/crypto-utils";
import { getSessionGuardSecret } from "@/lib/session-guard-secret";

/**
 * Minting for the signed, single-use token `/api/auth/magic` verifies.
 *
 * Extracted so the format has exactly one definition. It is a shared secret
 * between the issuer and the verifier in the literal sense — a second issuer
 * that drifted by a field name would produce links that fail only at the moment
 * an operator clicks one, which is the worst place to discover it.
 */

export interface MagicLinkSubject {
  principalId: string;
  tenantId: string;
  subject: string;
  email: string;
}

/**
 * Long enough to survive a slow inbox, short enough to bound a leaked link.
 *
 * Exported because a device authorization the link returns to must not outlive
 * it — see TRIAL_ONBOARDING_TTL_MINUTES, and the test that holds the two in
 * step.
 */
export const MAGIC_LINK_TTL_SECONDS = 60 * 15;

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(sig));
}

export async function issueMagicLinkToken(subject: MagicLinkSubject): Promise<string> {
  const secret = getSessionGuardSecret();
  const payloadJson = JSON.stringify({
    principalId: subject.principalId,
    tenantId: subject.tenantId,
    email: subject.email,
    subject: subject.subject,
    exp: Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_SECONDS,
    jti: randomBytes(16).toString("hex"), // single-use nonce, consumed on verify
  });
  const encodedPayload = toBase64Url(new TextEncoder().encode(payloadJson));
  return `${encodedPayload}.${await signValue(encodedPayload, secret)}`;
}

/**
 * The absolute link to email.
 *
 * `next` is placed verbatim, so callers must have already established that it
 * is a same-origin path — this function cannot tell a destination the operator
 * asked for from one an attacker supplied.
 */
export function buildMagicLink(params: {
  token: string;
  origin: string;
  next?: string | null;
}): string {
  const base = params.origin.replace(/\/$/, "");
  const next = params.next?.trim() || "/";
  return `${base}/api/auth/magic?token=${encodeURIComponent(params.token)}&next=${encodeURIComponent(next)}`;
}
