/**
 * Shared boolean parsing so a caller reading an injected environment reaches
 * the same verdict as one reading `process.env`. A startup guard and the route
 * it protects must never disagree about whether a flag is set.
 */
export function parseBooleanEnvValue(raw: string | undefined, defaultValue = false): boolean {
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function getBooleanEnv(name: string, defaultValue = false): boolean {
  return parseBooleanEnvValue(process.env[name], defaultValue);
}

export function getStringEnv(name: string, defaultValue = ""): string {
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

// ── Site ──────────────────────────────────────────────────────────────────────

export function getSiteUrl(): string {
  return getStringEnv("SPCTRE_SITE_URL");
}
