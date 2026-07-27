import { rawSql } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Sliding-window rate limit backed by the auth_rate_limit table.
 * Fails open (allows) if the DB is unavailable.
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
    if (!row) return { allowed: true, retryAfterSeconds: 0 };

    const windowEndMs = row.window_start.getTime() + params.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - Date.now()) / 1000));

    return {
      allowed: row.count <= params.limit,
      retryAfterSeconds: row.count <= params.limit ? 0 : retryAfterSeconds,
    };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
