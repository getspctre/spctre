// Relying Party configuration for the WebAuthn ceremonies. RP ID and the
// expected origin are security-critical: verification exact-matches the origin,
// so it must never be inferred from a request header. Configure PASSKEY_RP_ID
// and PASSKEY_EXPECTED_ORIGIN per environment (wired through spctre-infra for
// staging/prod, e.g. rpId "app-staging.spctre.dev").
//
// Note on multi-tenant subdomains: if tenants are ever served on distinct
// subdomains, PASSKEY_RP_ID must be set to the registrable parent domain so a
// credential registered on one host authenticates across all of them.

export function getPasskeyRpId(): string {
  return process.env.PASSKEY_RP_ID?.trim() || "localhost";
}

export function getPasskeyRpName(): string {
  return process.env.PASSKEY_RP_NAME?.trim() || "Spctre Control Plane";
}

/**
 * Exact origin(s) the ceremony must have occurred on. Returns an array so
 * multiple origins (e.g. apex + www) can be allowed. Falls back to
 * http(s)://<rpId> — and to http://localhost:3000 for local dev — only when
 * PASSKEY_EXPECTED_ORIGIN is unset.
 */
export function getPasskeyExpectedOrigins(): string[] {
  const configured = process.env.PASSKEY_EXPECTED_ORIGIN?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  const rpId = getPasskeyRpId();
  if (rpId === "localhost") return ["http://localhost:3000"];
  return [`https://${rpId}`];
}
