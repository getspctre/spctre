import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";

type FetchInitWithTimeout = Parameters<typeof fetchWithTimeout>[1] & {};

export type FetchRetryInit = FetchInitWithTimeout & {
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** Base backoff delay; grows exponentially with jitter (default 300ms). */
  baseDelayMs?: number;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

// 408/429 and 5xx are worth retrying; other statuses are answers, not outages.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delayWithJitter(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface BreakerEntry {
  consecutiveFailures: number;
  openedAt: number | null;
  halfOpen: boolean;
}

// Per-host circuit breaker. Per-instance on serverless (each Cloud Run
// instance learns independently), which still converts a down dependency
// from "every request waits out the full timeout" into "fail fast".
const breakers = new Map<string, BreakerEntry>();

export class CircuitOpenError extends Error {
  constructor(host: string) {
    super(`Circuit breaker open for ${host}; skipping outbound call.`);
    this.name = "CircuitOpenError";
  }
}

function breakerKey(input: RequestInfo | URL): string {
  try {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    return url.host.toLowerCase();
  } catch {
    return String(input);
  }
}

// "probe" marks the one call admitted through a half-open breaker; only that
// call may settle the probe on abort (see breakerAbandonProbe).
type BreakerAdmission = "closed" | "probe" | "rejected";

function breakerAllow(host: string, now: number): BreakerAdmission {
  const entry = breakers.get(host);
  if (!entry || entry.openedAt === null) return "closed";
  if (entry.halfOpen) return "rejected";
  if (now - entry.openedAt >= BREAKER_COOLDOWN_MS) {
    entry.halfOpen = true; // admit exactly one probe
    return "probe";
  }
  return "rejected";
}

function breakerRecord(host: string, success: boolean, now: number): void {
  let entry = breakers.get(host);
  if (!entry) {
    entry = { consecutiveFailures: 0, openedAt: null, halfOpen: false };
    breakers.set(host, entry);
  }
  if (success) {
    entry.consecutiveFailures = 0;
    entry.openedAt = null;
    entry.halfOpen = false;
    return;
  }
  entry.consecutiveFailures += 1;
  if (entry.halfOpen || entry.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
    entry.openedAt = now;
    entry.halfOpen = false;
  }
}

// Settles an abandoned half-open probe (the probe's caller aborted
// mid-flight). Without this the entry would stay halfOpen forever —
// breakerAllow rejects while a probe is outstanding — permanently blackholing
// the host. Clearing halfOpen returns the breaker to the open state with its
// original openedAt, so the next call is admitted as a fresh probe. Only the
// call admitted as the probe may call this: an aborted non-probe call must not
// release a probe another call is still holding.
function breakerAbandonProbe(host: string): void {
  const entry = breakers.get(host);
  if (entry?.halfOpen) {
    entry.halfOpen = false;
  }
}

/** Test-only: clear breaker state between test cases. */
export function resetFetchBreakers(): void {
  breakers.clear();
}

/**
 * fetchWithTimeout plus bounded, jittered-exponential-backoff retries and a
 * per-host circuit breaker. Retries fire only on network errors/timeouts and
 * 408/429/5xx responses, so it must only be used for idempotent or
 * idempotency-keyed requests (worker delegation, email, SMS, discovery GETs)
 * — never for single-use exchanges like OAuth authorization codes.
 *
 * A retryable final response is returned as-is (callers keep their !ok
 * handling); a final network failure rethrows; an open breaker throws
 * CircuitOpenError immediately without dialing.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchRetryInit = {}
): Promise<Response> {
  const { attempts = DEFAULT_ATTEMPTS, baseDelayMs = DEFAULT_BASE_DELAY_MS, ...fetchInit } = init;
  const totalAttempts = Math.max(1, attempts);
  const host = breakerKey(input);

  const admission = breakerAllow(host, Date.now());
  if (admission === "rejected") {
    throw new CircuitOpenError(host);
  }

  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(delayWithJitter(baseDelayMs, attempt - 1));
    }
    try {
      const response = await fetchWithTimeout(input, fetchInit);
      if (!isRetryableStatus(response.status)) {
        breakerRecord(host, true, Date.now());
        return response;
      }
      lastResponse = response;
      lastError = undefined;
      if (attempt < totalAttempts) {
        // Release the connection before retrying.
        await response.body?.cancel().catch(() => {});
      }
    } catch (err) {
      // A caller-initiated abort is a decision, not a failure — propagate,
      // but if this call was holding the half-open probe, settle it so the
      // breaker doesn't stay half-open (rejecting all callers) forever.
      if (fetchInit.signal?.aborted) {
        if (admission === "probe") {
          breakerAbandonProbe(host);
        }
        throw err;
      }
      lastError = err;
      lastResponse = null;
    }
  }

  breakerRecord(host, false, Date.now());
  if (lastResponse) return lastResponse;
  throw lastError;
}
