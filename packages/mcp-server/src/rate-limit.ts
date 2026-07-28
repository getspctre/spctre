import { createHash } from "node:crypto";

// Per-caller token-bucket rate limiter for the stateless HTTP transport.
//
// The stateless rewrite builds a fresh SpctreMcpServer per request and, on the
// hot paths, fans out a token refresh plus an MCP-policy fetch onto the control
// plane. Cloud Run bounds *concurrency* (per-instance concurrency x max
// instances) but not *request rate* and offers no per-caller fairness, so a
// single abusive token can monopolize the tier and amplify load upstream. This
// restores the per-second throttle removed with the old SSE session limiter,
// keyed on the actual unit of abuse — the bearer token (or client IP when
// unauthenticated).
//
// State is process-local: every instance enforces its own budget. That is the
// standard shape for horizontally-scaled limiters and, combined with the
// Cloud Run ceilings, keeps total fan-out bounded without shared state.

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until one token is available again; 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface TokenBucketOptions {
  /** Sustained request rate per key. Values <= 0 are treated as 1. */
  perSecond: number;
  /** Maximum burst (bucket capacity). Values < 1 are treated as 1. */
  burst: number;
  /** Hard ceiling on tracked keys before reclamation kicks in. */
  maxKeys?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: TokenBucketOptions) {
    this.capacity = Math.max(1, options.burst);
    this.refillPerMs = Math.max(options.perSecond, 1) / 1000;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.reclaim(now);
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefillMs;
      if (elapsed > 0) {
        bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
        bucket.lastRefillMs = now;
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }

    const retryAfterMs = Math.ceil((1 - bucket.tokens) / this.refillPerMs);
    return { allowed: false, retryAfterMs };
  }

  // Bound memory when many distinct keys are seen. Deleting a bucket that has
  // refilled back to capacity is lossless — a fresh bucket also starts full —
  // so idle callers are the safe eviction target. If nothing is idle (every
  // tracked key is actively throttled), fall back to evicting the
  // least-recently-seen bucket so the map can never grow without bound.
  private reclaim(now: number): void {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [key, bucket] of this.buckets) {
      const projected = Math.min(this.capacity, bucket.tokens + (now - bucket.lastRefillMs) * this.refillPerMs);
      if (projected >= this.capacity) {
        this.buckets.delete(key);
        continue;
      }
      if (bucket.lastRefillMs < oldestAt) {
        oldestAt = bucket.lastRefillMs;
        oldestKey = key;
      }
    }
    if (this.buckets.size >= this.maxKeys && oldestKey) this.buckets.delete(oldestKey);
  }
}

// Derive the throttle key. Bearer tokens are hashed so the raw secret is never
// retained in the long-lived bucket map; the truncated digest keeps a distinct
// key per token without storing it. Unauthenticated callers (only possible when
// bearer auth is disabled) fall back to client IP.
export function rateLimitKey(bearer: string | undefined, clientIp: string): string {
  if (bearer) return `t:${createHash("sha256").update(bearer).digest("base64url").slice(0, 22)}`;
  return `ip:${clientIp}`;
}
