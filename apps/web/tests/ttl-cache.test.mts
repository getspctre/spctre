import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "../lib/platform/ttl-cache";

describe("createTtlCache", () => {
  it("loads once and serves cached value within the TTL", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000 });
    const load = vi.fn(async () => 42);

    expect(await cache.get("k", load)).toBe(42);
    expect(await cache.get("k", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const cache = createTtlCache<number>({ ttlMs: 1000 });
      let n = 0;
      const load = vi.fn(async () => ++n);

      expect(await cache.get("k", load)).toBe(1);
      vi.advanceTimersByTime(1001);
      expect(await cache.get("k", load)).toBe(2);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keys are independent", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000 });
    expect(await cache.get("a", async () => "A")).toBe("A");
    expect(await cache.get("b", async () => "B")).toBe("B");
    expect(await cache.get("a", async () => "reload")).toBe("A");
  });

  it("invalidate forces a reload", async () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000 });
    let n = 0;
    const load = async () => ++n;
    expect(await cache.get("k", load)).toBe(1);
    cache.invalidate("k");
    expect(await cache.get("k", load)).toBe(2);
  });

  it("stays bounded by maxEntries", async () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 3 });
    for (let i = 0; i < 10; i++) {
      await cache.get(`k${i}`, async () => i);
    }
    // The oldest keys were evicted, so re-getting them reloads (new value).
    const reload = vi.fn(async () => -1);
    expect(await cache.get("k0", reload)).toBe(-1);
    expect(reload).toHaveBeenCalledTimes(1);
    // A very recent key is still cached.
    const recentLoad = vi.fn(async () => -2);
    expect(await cache.get("k9", recentLoad)).toBe(9);
    expect(recentLoad).not.toHaveBeenCalled();
  });
});
