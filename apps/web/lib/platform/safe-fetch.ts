import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { isBlockedAddress, isBlockedHostname } from "./url-guard";

/**
 * A DNS lookup that resolves every address for a hostname and rejects the
 * connection if ANY resolved address is private/loopback/link-local/metadata.
 *
 * Because undici calls this at connect time (for the initial request and for
 * every redirect hop), it closes the DNS-rebinding / time-of-check-time-of-use
 * gap that a write-time hostname check cannot: an attacker cannot point a
 * hostname at an internal IP, because the address that will actually be dialed
 * is the one being validated here.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...(options as object), all: true, verbatim: true }, (err, addresses) => {
    const cb = callback as (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    if (err) {
      cb(err, "", 0);
      return;
    }
    const list = addresses as unknown as { address: string; family: number }[];
    for (const entry of list) {
      if (isBlockedAddress(entry.address)) {
        cb(
          Object.assign(new Error(`Blocked SSRF target: ${entry.address}`), {
            code: "ESSRFBLOCKED",
          }),
          "",
          0,
        );
        return;
      }
    }
    if ((options as { all?: boolean })?.all) {
      cb(null, list);
    } else {
      cb(null, list[0].address, list[0].family);
    }
  });
};

// Shared dispatcher — the guarded lookup is stateless, so one agent is reused.
const guardedAgent = new Agent({
  connect: { lookup: guardedLookup },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
});

export type SafeFetchInit = UndiciRequestInit & { timeoutMs?: number };

/**
 * Fetches a user-supplied URL with SSRF protection:
 *  - requires HTTPS,
 *  - blocks known metadata hostnames and IP-literal internal addresses up front,
 *  - validates the resolved IP at connect time via {@link guardedLookup},
 *  - refuses to follow redirects (redirect targets would bypass the pre-flight
 *    host check; each hop is still connect-validated, but disallowing redirects
 *    keeps the behavior simple and predictable for webhook endpoints).
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("URL must use HTTPS.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new Error("URL targets a disallowed host.");
  }
  if (isBlockedAddress(hostname)) {
    throw new Error("URL targets a private or link-local address.");
  }

  const { timeoutMs = 10_000, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort((signal as AbortSignal).reason);
    else
      signal.addEventListener("abort", () => controller.abort((signal as AbortSignal).reason), {
        once: true,
      });
  }

  try {
    const response = await undiciFetch(url, {
      ...rest,
      dispatcher: guardedAgent,
      redirect: "error",
      signal: controller.signal,
    });
    return response as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}
