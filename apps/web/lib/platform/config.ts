/**
 * Shared boolean parsing so a caller reading an injected environment reaches
 * the same verdict as one reading `process.env`. A startup guard and the route
 * it protects must never disagree about whether a flag is set.
 */
function parseBooleanEnvValue(raw: string | undefined, defaultValue = false): boolean {
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function getBooleanEnv(name: string, defaultValue = false): boolean {
  return parseBooleanEnvValue(process.env[name], defaultValue);
}

function getStringEnv(name: string, defaultValue = ""): string {
  return process.env[name]?.trim() ?? defaultValue;
}

// ── Gateway ───────────────────────────────────────────────────────────────────

export function isGatewayEnabled(): boolean {
  return getBooleanEnv("GATEWAY_ENABLED");
}

export function gatewayMode(): string {
  return getStringEnv("GATEWAY_MODE", "HYBRID");
}

// ── Evidence ingest ──────────────────────────────────────────────────────────

export function evidenceIngestUrl(): string {
  return getStringEnv("SPCTRE_EVIDENCE_INGEST_URL");
}

export function workerInternalSecret(): string {
  return getStringEnv("SPCTRE_WORKER_INTERNAL_SECRET");
}

// ── Provisioning ─────────────────────────────────────────────────────────────

// Shared secret the checkout surface presents when asking the control plane to
// provision a paid tenant. Distinct from the worker secret: a leak of one must
// not grant the other's capability.
export function provisioningSecret(): string {
  return getStringEnv("SPCTRE_PROVISIONING_SECRET");
}

/**
 * Credential for operator grants, which may provision any plan and mark the
 * account INTERNAL.
 *
 * Separate from SPCTRE_PROVISIONING_SECRET on purpose. That secret is held by a
 * checkout surface whose only legitimate need is the plan a customer just paid
 * for, so it must not be able to mint the top tier — the two callers differ in
 * authority, not just in intent. Unset means no grant caller exists and the
 * endpoint offers no way to create one.
 */
export function provisioningGrantSecret(): string {
  return getStringEnv("SPCTRE_PROVISIONING_GRANT_SECRET");
}

/**
 * Plans the checkout credential may provision. Defaults to the self-serve
 * tiers: ENTERPRISE is sold through an order form, never through a checkout,
 * so a checkout surface has no reason to be able to ask for it.
 *
 * A self-hosted deployment that drives provisioning from its own tooling can
 * widen this to whatever it likes; there is no licence being enforced here,
 * only the authority of one credential.
 */
export function provisioningCheckoutPlans(): string[] {
  const configured = getStringEnv("SPCTRE_PROVISIONING_ALLOWED_PLANS");
  if (!configured.trim()) return ["HOSTED_TRIAL", "TEAM", "BUSINESS"];
  return configured
    .split(",")
    .map((plan) => plan.trim().toUpperCase())
    .filter(Boolean);
}

// ── Site ──────────────────────────────────────────────────────────────────────

export function getSiteUrl(): string {
  return getStringEnv("SPCTRE_SITE_URL");
}
