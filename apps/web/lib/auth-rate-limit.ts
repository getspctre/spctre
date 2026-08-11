import { rawSql } from "@/lib/db";
import { logSecurityEvent } from "@/lib/security-logger";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * How long a caller is asked to wait when the limiter itself is unavailable.
 * Short enough that a transient blip is not an outage, long enough that a
 * caller cannot spin against a degraded database.
 */
const LIMITER_UNAVAILABLE_RETRY_SECONDS = 5;

/**
 * Sliding-window rate limit backed by the auth_rate_limit table.
 *
 * Fails **closed**: this limiter guards magic-link issuance, recovery-code
 * verification and MFA verification, and it is backed by the same database it
 * is protecting. Allowing on error meant an attacker who could stress the
 * database — cheap against a small instance — also switched the limiter off,
 * turning load into unlimited credential attempts. A request-time failure now
 * denies with a short Retry-After instead.
 *
 * The one deliberate exception is a deployment with no database client at all
 * (`rawSql` unset). That is a static configuration state an attacker cannot
 * induce per request, and authentication cannot function without a database
 * anyway, so it stays permissive rather than making a DB-less checkout appear
 * to be under attack.
 */
export async function checkAuthRateLimit(params: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  if (!rawSql) return { allowed: true, retryAfterSeconds: 0 };

  const windowCutoff = new Date(Date.now() - params.windowSeconds * 1000);

  try {
    const rows = await rawSql<{ count: number; window_start: Date }[]>`
      INSERT INTO auth_rate_limit (key, count, window_start)
      VALUES (${params.key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN auth_rate_limit.window_start < ${windowCutoff}
          THEN 1
          ELSE auth_rate_limit.count + 1
        END,
        window_start = CASE
          WHEN auth_rate_limit.window_start < ${windowCutoff}
          THEN now()
          ELSE auth_rate_limit.window_start
        END
      RETURNING count, window_start
    `;

    const row = rows[0];
    if (!row) {
      // The upsert always RETURNs a row, so an empty result is an unexpected
      // state rather than a "no limit recorded" signal. Treat it as limiter
      // failure, not as permission.
      logSecurityEvent("rate_limited", { detail: "auth rate limiter returned no row; denying" });
      return { allowed: false, retryAfterSeconds: LIMITER_UNAVAILABLE_RETRY_SECONDS };
    }

    const windowEndMs = row.window_start.getTime() + params.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - Date.now()) / 1000));

    return {
      allowed: row.count <= params.limit,
      retryAfterSeconds: row.count <= params.limit ? 0 : retryAfterSeconds,
    };
  } catch (error) {
    logSecurityEvent("rate_limited", {
      detail: `auth rate limiter unavailable; denying: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { allowed: false, retryAfterSeconds: LIMITER_UNAVAILABLE_RETRY_SECONDS };
  }
}
