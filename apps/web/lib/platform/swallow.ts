import { logger } from "@spctre/platform/logging";
import { incrementCounter } from "@spctre/platform/metrics";

/**
 * Observable degradation for read/side-effect failures.
 *
 * A bare `.catch(() => fallback)` collapses four very different outcomes —
 * "this tenant legitimately has no data", "the query has a bug", "tenant
 * context / RLS is misbound", and "the database is unreachable" — into the
 * same healthy-looking empty state. In production the error never surfaces:
 * the page renders empty (or a permissive default) and the failure is
 * indistinguishable from success. That is how latent bugs hide.
 *
 * `swallow` preserves the exact same fallback behaviour but makes every
 * degrade observable: it emits a warning log and increments a counter keyed
 * by operation before returning the fallback. Use it as a drop-in for
 * `.catch(() => fallback)`:
 *
 *   const rows = await listBranches(workspaceId, tenantId)
 *     .catch(swallow("listBranches", []));
 *
 * `op` is a stable, low-cardinality label (typically the repository/function
 * name being called) so the counter stays bounded. Never pass per-tenant or
 * per-request values as `op`.
 *
 * This intentionally does not change control flow — it does not rethrow. If a
 * failure should abort the request rather than degrade, do not catch it here;
 * let it propagate (or handle it explicitly with a degraded flag surfaced to
 * the caller).
 */
export function swallow<T>(
  op: string,
  fallback: T,
  meta?: Record<string, unknown>,
): (error: unknown) => T {
  return (error) => {
    reportSwallowedError(op, error, meta);
    return fallback;
  };
}

/**
 * Report a swallowed error without substituting a value. Use for
 * fire-and-forget side effects whose failure should be observable but must
 * not abort the caller (e.g. audit-event or operations-log writes):
 *
 *   void appendOperationsLog(...).catch(swallow("appendOperationsLog", undefined));
 *
 * or, when a bespoke handler is unavoidable, call this from inside it.
 */
export function reportSwallowedError(
  op: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  logger.warn("degraded to fallback after swallowed error", {
    op,
    error: error instanceof Error ? error.message : String(error),
    ...meta,
  });
  incrementCounter("spctre.swallowed_read_error", 1, { op });
}
