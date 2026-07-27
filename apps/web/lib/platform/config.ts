export function getBooleanEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
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

// ── Site ──────────────────────────────────────────────────────────────────────

export function getSiteUrl(): string {
  return getStringEnv("SPCTRE_SITE_URL");
}
