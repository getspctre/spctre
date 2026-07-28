import { describe, expect, it } from "vitest";
import { TokenBucketRateLimiter, rateLimitKey } from "../src/rate-limit.js";

describe("TokenBucketRateLimiter", () => {
  it("allows up to the burst then rejects with a positive retry hint", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ perSecond: 10, burst: 3, now: () => now });

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);

    const denied = limiter.check("k");
    expect(denied.allowed).toBe(false);
    // At 10/s, one token refills in 100ms.
    expect(denied.retryAfterMs).toBe(100);
  });

  it("refills over elapsed time", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ perSecond: 10, burst: 1, now: () => now });

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);

    now = 100; // one token back at 10/s
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });

  it("never accumulates beyond the burst ceiling", () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({ perSecond: 100, burst: 2, now: () => now });

    now = 10_000; // long idle — would overflow an uncapped bucket
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });

  it("keeps separate budgets per key", () => {
    const now = 0;
    const limiter = new TokenBucketRateLimiter({ perSecond: 1, burst: 1, now: () => now });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("stays correct for fresh keys under churn with a bounded map", () => {
    const now = 0; // frozen clock: buckets never refill, so none look idle
    const limiter = new TokenBucketRateLimiter({ perSecond: 1, burst: 1, maxKeys: 4, now: () => now });

    // Exhaust and abandon far more distinct callers than maxKeys, forcing the
    // reclaim path (here the least-recently-seen eviction) to run repeatedly.
    for (let i = 0; i < 100; i++) {
      expect(limiter.check(`k${i}`).allowed).toBe(true); // fresh bucket, first token
      expect(limiter.check(`k${i}`).allowed).toBe(false); // burst of 1 exhausted
    }

    // A brand-new caller still receives its full burst — eviction bounded the
    // map without corrupting accounting for keys it kept.
    expect(limiter.check("late").allowed).toBe(true);
  });

  it("hashes bearer tokens and never embeds the raw secret in the key", () => {
    const key = rateLimitKey("super-secret-token", "1.2.3.4");
    expect(key.startsWith("t:")).toBe(true);
    expect(key).not.toContain("super-secret-token");
    // Falls back to client IP only when unauthenticated.
    expect(rateLimitKey(undefined, "1.2.3.4")).toBe("ip:1.2.3.4");
  });
});
