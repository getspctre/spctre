import { getRuntimeConfig } from "@/lib/config/runtime";
import { makeMeta, withTraceId } from "@spctre/api-contracts";

/**
 * Guard for the E2E support routes, which draft, approve and publish policy
 * revisions outside the reviewed path.
 *
 * The authoritative gate is in `lib/config/runtime.ts`: a production runtime
 * refuses to start with `SPCTRE_E2E_API_ENABLED` set, so these routes cannot be
 * reachable in production regardless of what this returns. This is the
 * development-mode half — it keeps the routes absent unless a developer opts in.
 *
 * Returns a 404 response when the API is disabled, or `null` to continue. 404
 * rather than 403 so a disabled deployment does not advertise the surface.
 */
export function e2eApiDisabledResponse(traceId: string): Response | null {
  if (getRuntimeConfig().e2eApiEnabled) return null;
  return withTraceId(
    Response.json(
      { error: "E2E support API is disabled.", meta: makeMeta(traceId) },
      { status: 404 },
    ),
    traceId,
  );
}
