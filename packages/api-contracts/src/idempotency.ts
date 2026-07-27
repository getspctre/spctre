/**
 * In-process idempotency cache for write endpoints that don't have a DB-level
 * unique constraint to catch duplicates (e.g. token/refresh).
 *
 * Each entry expires after `ttlMs` milliseconds. The cache is bounded to
 * MAX_ENTRIES; oldest entries are evicted when the limit is reached.
 *
 * This is intentionally a simple in-memory structure. It guards against
 * accidental double-submissions from the same server process. For multi-replica
 * deployments, pair this with a Redis-based distributed cache (Phase 3).
 */

const DEFAULT_TTL_MS = 60_000; // 1 minute
const MAX_ENTRIES = 2_048;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class IdempotencyCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= MAX_ENTRIES) {
      // Evict the oldest entry.
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}
