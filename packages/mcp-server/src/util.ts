import type { Request } from "express";

// Small stateless parsing helpers shared by the transport bootstrap and config
// loading. Extracted from the former monolithic index.ts (maintainability audit
// Hotspot 1) so the composition root stays free of parsing minutiae.

export function parseCsv(value: string | undefined): string[] | undefined {
  const entries = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

export function parseBearerFromAuthHeader(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return undefined;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || undefined;
}

export function parseAllowedSourceIps(): Set<string> {
  return new Set(
    (process.env.SPCTRE_ALLOWED_SOURCE_IPS || "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
}

/**
 * How many proxies in front of this server append to `x-forwarded-for`.
 *
 * The header is caller-supplied until a proxy we control appends to it, so only
 * the entries a known proxy added can be trusted. With N declared hops the
 * client address is the Nth entry from the right; anything to its left was sent
 * by the caller. Unset keeps the historical leftmost-entry behaviour, which is
 * spoofable — the same contract as the control plane's SPCTRE_TRUSTED_PROXY_HOPS.
 */
function trustedProxyHops(): number | null {
  const raw = process.env.SPCTRE_TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return null;
  const hops = Number.parseInt(raw, 10);
  return Number.isFinite(hops) && hops > 0 ? hops : null;
}

/**
 * Stands in for a client address that cannot be attributed. Never an address,
 * so it can never appear in SPCTRE_ALLOWED_SOURCE_IPS and pass the allowlist.
 */
export const UNATTRIBUTABLE_CLIENT_IP = "unattributable";

export function getClientIp(req: Request): string {
  const forwarded = (req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const hops = trustedProxyHops();

  if (hops !== null) {
    // Fewer entries than declared hops means the request did not traverse the
    // proxy chain we declared. Falling back to req.ip or the socket address
    // would answer with the proxy's own address or another caller-supplied
    // header, so nothing here is attributable.
    return forwarded[forwarded.length - hops] ?? UNATTRIBUTABLE_CLIENT_IP;
  }

  return forwarded[0] || req.ip || req.socket.remoteAddress || "";
}
