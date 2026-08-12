import { logger } from "@spctre/platform/logging";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";

type Span = Parameters<Parameters<typeof withSpan>[2]>[0];
type NextRouteContext = { params: Promise<unknown> };

export interface ApiRouteContext {
  traceId: string;
  span: Span;
  /** JSON response with the trace header and response meta attached. */
  json(body: Record<string, unknown>, init?: ResponseInit): Response;
  /**
   * Error envelope: records the route error metric, attaches meta and the
   * trace header. Extra fields are merged into the response body.
   */
  error(status: number, message: string, extra?: Record<string, unknown>): Response;
}

/**
 * Shared wrapper for API route handlers. Owns trace extraction, the request
 * span, the error/response envelope, and error metrics so individual routes
 * don't repeat the incrementCounter + withTraceId(Response.json(...)) pattern.
 *
 * The span is named api.<segments> from the route path
 * (e.g. /api/gateway/decide -> api.gateway.decide).
 */
export function withApiRoute<TContext = NextRouteContext>(
  route: string,
  handler: (request: Request, ctx: ApiRouteContext, routeContext: TContext) => Promise<Response>,
): (request: Request, routeContext: TContext) => Promise<Response> {
  const spanName = route.replace(/^\//, "").replaceAll("/", ".");

  return async (request: Request, routeContext: TContext) => {
    const traceId = extractTraceId(request);
    return withSpan(
      spanName,
      { "spctre.request_id": traceId, "http.route": route },
      async (span) => {
        const ctx: ApiRouteContext = {
          traceId,
          span,
          json(body, init) {
            return withTraceId(Response.json({ ...body, meta: makeMeta(traceId) }, init), traceId);
          },
          error(status, message, extra) {
            incrementCounter("spctre.api.errors", 1, {
              "http.route": route,
              "http.response.status_code": status,
            });
            return withTraceId(
              Response.json({ error: message, ...extra, meta: makeMeta(traceId) }, { status }),
              traceId,
            );
          },
        };

        try {
          return await handler(request, ctx, routeContext);
        } catch (err) {
          logger.error(`[${route}] unhandled error:`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return ctx.error(500, "Internal server error.");
        }
      },
    );
  };
}
