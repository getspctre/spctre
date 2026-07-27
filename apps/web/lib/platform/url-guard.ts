import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254",
  "instance-data",
  "localhost",
]);

const SENTINEL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.has(hostname.trim().toLowerCase());
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 0) return true; // "this" network / unspecified
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped / -embedded addresses (e.g. ::ffff:169.254.169.254) — validate
  // the embedded IPv4 against the v4 rules.
  const embedded = normalized.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded && isBlockedIpv4(embedded[1])) return true;
  if (normalized === "::" || normalized === "::1") return true; // unspecified + loopback
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
  return false;
}

/**
 * Returns true if the given IP-literal string points at a private, loopback,
 * link-local, CGNAT, multicast, or cloud-metadata address. Accepts IPv4 and
 * IPv6 (including IPv4-mapped IPv6). Non-IP input returns false.
 */
export function isBlockedAddress(host: string): boolean {
  const family = isIP(host);
  if (family === 4) return isBlockedIpv4(host);
  if (family === 6) return isBlockedIpv6(host);
  // Not a valid IP literal — cannot decide here (DNS resolution handles it).
  return false;
}

/**
 * Validates a user-supplied webhook URL before persisting. Throws if the URL
 * is not HTTPS or targets a private/link-local/metadata address.
 *
 * NOTE: this is a write-time UX check only. It cannot see what a hostname
 * *resolves* to (DNS records pointing at internal IPs, decimal/octal IP
 * encodings, etc.), so the authoritative defense is applied at fetch time by
 * `safeFetch` (web) and the worker's Control-guarded HTTP client (Go), which
 * validate the actually-resolved address at connect time.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new Error("Webhook URL targets a disallowed host.");
  }
  if (isBlockedAddress(hostname)) {
    throw new Error("Webhook URL must not target a private or link-local address.");
  }
}

/**
 * Validates a Microsoft Sentinel workspace ID. The value stored in the `url`
 * field for SENTINEL integrations must be a plain UUID — it is interpolated
 * into an Azure hostname by the Go worker.
 */
export function validateSentinelWorkspaceId(value: string): void {
  if (!SENTINEL_UUID_RE.test(value)) {
    throw new Error("Sentinel workspace ID must be a valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).");
  }
}
