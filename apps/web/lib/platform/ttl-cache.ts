// Small in-process TTL cache for expensive, staleness-tolerant reads (e.g.
// per-page-view COUNT(*) totals). Values are cached per web instance, so under
// horizontal scale-out a reader may see a value up to ttlMs stale — only use it
// where that is acceptable (display totals, not correctness-critical checks).
// See database-optimizations-audit finding 5.
//
// Bounded so it can never grow without limit across tenants/workspaces: once
// maxEntries is reached, expired entries are purged first and then the oldest
// live entry is evicted (Map preserves insertion order).

export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  invalidate(key: string): void;
}

export function createTtlCache<T>(opts: { ttlMs: number; maxEntries?: number }): TtlCache<T> {
  const ttlMs = opts.ttlMs;
  const maxEntries = opts.maxEntries ?? 1000;
  const store = new Map<string, { value: T; expires: number }>();

  return {
    async get(key, load) {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expires > now) return hit.value;

      const value = await load();

      if (!store.has(key) && store.size >= maxEntries) {
        for (const [k, v] of store) {
          if (v.expires <= now) store.delete(k);
        }
        if (store.size >= maxEntries) {
          const oldest = store.keys().next().value;
          if (oldest !== undefined) store.delete(oldest);
        }
      }
      // Re-insert at the tail so refreshes count as most-recently-used.
      store.delete(key);
      store.set(key, { value, expires: now + ttlMs });
      return value;
    },
    invalidate(key) {
      store.delete(key);
    },
  };
}
