// SAML AuthnRequest ID cache (migration 076). Backs node-saml's InResponseTo
// replay protection with a Postgres store so the request/response binding holds
// across multiple instances (Cloud Run scale-to-zero), where an in-memory cache
// would not. Written pre-session during SAML authorize/callback, so queries run
// without a bound tenant context — the same path as upsertSamlPrincipal.
import { sql } from "@/lib/db";

/**
 * Record a generated AuthnRequest ID. Fails closed if it cannot persist a fresh
 * binding, including the cryptographically unlikely request-ID collision.
 * @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/)
 */
export async function saveSamlAuthnRequestId(params: {
  tenantId: string;
  requestId: string;
  value: string;
  ttlSeconds: number;
}): Promise<void> {
  if (!sql || !params.requestId || !params.tenantId) {
    throw new Error("Failed to persist SAML AuthnRequest ID");
  }

  const rows = await sql<{ request_id: string }[]>`
    WITH pruned_expired_requests AS (
      DELETE FROM saml_authn_request
      WHERE expires_at < now()
    )
    INSERT INTO saml_authn_request (request_id, tenant_id, value, expires_at)
    VALUES (
      ${params.requestId},
      ${params.tenantId},
      ${params.value},
      now() + make_interval(secs => ${params.ttlSeconds})
    )
    ON CONFLICT (request_id) DO NOTHING
    RETURNING request_id
  `;

  if (rows.length === 0) throw new Error("Failed to persist SAML AuthnRequest ID");
}

/**
 * Atomically lease an unexpired AuthnRequest ID and return its stored value
 * (the request instant). A lease must be finalized only after SAML validation
 * succeeds, or released when it fails.
 * @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/)
 */
export async function claimSamlAuthnRequestValue(params: {
  tenantId: string;
  requestId: string;
  leaseId: string;
  leaseSeconds: number;
}): Promise<string | null> {
  if (!sql || !params.tenantId || !params.requestId || !params.leaseId) return null;

  const rows = await sql<{ value: string }[]>`
    UPDATE saml_authn_request
    SET validation_lease_id = ${params.leaseId},
        validation_lease_expires_at = now() + make_interval(secs => ${params.leaseSeconds})
    WHERE request_id = ${params.requestId}
      AND tenant_id = ${params.tenantId}
      AND expires_at > now()
      AND consumed_at IS NULL
      AND (validation_lease_expires_at IS NULL OR validation_lease_expires_at <= now())
    RETURNING value
  `;

  return rows[0]?.value ?? null;
}

/** Release a validation lease after node-saml rejects the response. */
export async function releaseSamlAuthnRequestLease(params: {
  tenantId: string;
  requestId: string;
  leaseId: string;
}): Promise<void> {
  if (!sql || !params.tenantId || !params.requestId || !params.leaseId) return;

  await sql`
    UPDATE saml_authn_request
    SET validation_lease_id = NULL,
        validation_lease_expires_at = NULL
    WHERE request_id = ${params.requestId}
      AND tenant_id = ${params.tenantId}
      AND validation_lease_id = ${params.leaseId}
      AND consumed_at IS NULL
  `;
}

/** Mark a successfully validated AuthnRequest ID as permanently consumed. */
export async function finalizeSamlAuthnRequestLease(params: {
  tenantId: string;
  requestId: string;
  leaseId: string;
}): Promise<boolean> {
  if (!sql || !params.tenantId || !params.requestId || !params.leaseId) return false;

  const rows = await sql<{ request_id: string }[]>`
    UPDATE saml_authn_request
    SET consumed_at = now(),
        validation_lease_id = NULL,
        validation_lease_expires_at = NULL
    WHERE request_id = ${params.requestId}
      AND tenant_id = ${params.tenantId}
      AND validation_lease_id = ${params.leaseId}
      AND consumed_at IS NULL
    RETURNING request_id
  `;

  return rows.length > 0;
}
