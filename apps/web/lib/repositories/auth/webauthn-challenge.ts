// Server-side, one-time WebAuthn challenge store (migration 003). The challenge
// is generated server-side by @simplewebauthn/server and must be consumed
// exactly once to prevent replay. Usernameless login has no principal/tenant to
// bind at "start", so the challenge lives here keyed by an opaque id carried in
// a short-lived httpOnly cookie. webauthn_challenge is RLS-excluded and written
// pre-session — the same path as saml_authn_request.
import { sql } from "@/lib/db";

export type WebauthnChallengePurpose = "REGISTRATION" | "AUTHENTICATION";

/**
 * Persist a challenge and return its opaque id (to be stored in an httpOnly
 * cookie that binds it to this browser). Prunes expired rows opportunistically.
 * Returns null when the database is not configured.
 */
export async function saveWebauthnChallenge(params: {
  purpose: WebauthnChallengePurpose;
  challenge: string;
  principalId?: string | null;
  tenantId?: string | null;
  ttlSeconds: number;
}): Promise<string | null> {
  if (!sql || !params.challenge) return null;

  const rows = await sql<{ id: string }[]>`
    WITH pruned_expired_challenges AS (
      DELETE FROM webauthn_challenge
      WHERE expires_at < now()
    )
    INSERT INTO webauthn_challenge (purpose, challenge, principal_id, tenant_id, expires_at)
    VALUES (
      ${params.purpose},
      ${params.challenge},
      ${params.principalId ?? null},
      ${params.tenantId ?? null},
      now() + make_interval(secs => ${params.ttlSeconds})
    )
    RETURNING id
  `;

  return rows[0]?.id ?? null;
}

export interface ConsumedWebauthnChallenge {
  challenge: string;
  principalId: string | null;
  tenantId: string | null;
}

/**
 * Atomically consume (delete) an unexpired challenge by id and purpose,
 * returning its stored value. A second attempt returns null, so a challenge can
 * never be replayed. Returns null when missing, expired, wrong purpose, or the
 * database is not configured.
 */
export async function consumeWebauthnChallenge(params: {
  id: string;
  purpose: WebauthnChallengePurpose;
}): Promise<ConsumedWebauthnChallenge | null> {
  if (!sql || !params.id) return null;

  const rows = await sql<
    { challenge: string; principal_id: string | null; tenant_id: string | null }[]
  >`
    DELETE FROM webauthn_challenge
    WHERE id = ${params.id}
      AND purpose = ${params.purpose}
      AND expires_at > now()
    RETURNING challenge, principal_id, tenant_id
  `;

  const row = rows[0];
  if (!row) return null;
  return { challenge: row.challenge, principalId: row.principal_id, tenantId: row.tenant_id };
}
