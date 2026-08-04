import { rotateRefreshToken } from "@/lib/service-tokens";
import { evidenceIngestUrl } from "@/lib/platform/config";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import {
  TokenRefreshSchema,
  extractTraceId,
  extractIdempotencyKey,
  makeMeta,
  parseBody,
  IdempotencyCache,
  withTraceId,
} from "@spctre/api-contracts";
import type { TokenPairResponse } from "@spctre/api-contracts";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";

// Per-process idempotency cache for token refresh.
// Guards against duplicate submissions within a 60-second window.
const refreshIdempotencyCache = new IdempotencyCache<TokenPairResponse>(60_000);

export const dynamic = "force-dynamic";

async function handlePostApiTokenRefresh(request: Request) {
  const traceId = extractTraceId(request);
  const started = Date.now();
  return await withSpan(
    "api.token.refresh",
    { "spctre.request_id": traceId, "http.route": "/api/token/refresh" },
    async () => {
      const idempotencyKey = extractIdempotencyKey(request);

      // Return cached response for repeated requests with the same idempotency key.
      if (idempotencyKey) {
        const cached = refreshIdempotencyCache.get(idempotencyKey);
        if (cached) {
          incrementCounter("spctre.token.refresh", 1, { outcome: "cached" });
          return withTraceId(
            Response.json({ ...cached, meta: makeMeta(traceId) }, { status: 200 }),
            traceId,
          );
        }
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/token/refresh",
          "http.response.status_code": 400,
        });
        return withTraceId(
          Response.json(
            { error: "Request body must be JSON.", meta: makeMeta(traceId) },
            { status: 400 },
          ),
          traceId,
        );
      }

      const parsed = parseBody(TokenRefreshSchema, payload);
      if (!parsed.ok) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/token/refresh",
          "http.response.status_code": 400,
        });
        return withTraceId(
          Response.json(
            { error: parsed.error, issues: parsed.issues, meta: makeMeta(traceId) },
            { status: 400 },
          ),
          traceId,
        );
      }

      const delegated = await delegateTokenRefreshToWorker(parsed.value, request, traceId);
      if (delegated) return delegated;

      const result = await rotateRefreshToken(parsed.value.refreshToken);
      if (!result.ok) {
        incrementCounter("spctre.token.refresh", 1, {
          outcome: "failure",
          "http.response.status_code": result.status,
        });
        return withTraceId(
          Response.json(
            { error: result.error, meta: makeMeta(traceId) },
            { status: result.status },
          ),
          traceId,
        );
      }

      const { pair } = result;
      const responseBody: TokenPairResponse = {
        accessToken: pair.accessToken,
        accessTokenExpiresAt: pair.accessTokenExpiresAt,
        refreshToken: pair.refreshToken,
        refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
      };

      if (idempotencyKey) {
        refreshIdempotencyCache.set(idempotencyKey, responseBody);
      }

      incrementCounter("spctre.token.refresh", 1, { outcome: "success" });
      recordDuration("spctre.token.refresh.duration", Date.now() - started, { outcome: "success" });
      return withTraceId(Response.json({ ...responseBody, meta: makeMeta(traceId) }), traceId);
    },
  );
}

async function delegateTokenRefreshToWorker(
  payload: { refreshToken: string },
  request: Request,
  traceId: string,
): Promise<Response | null> {
  const baseUrl = evidenceIngestUrl();
  if (!baseUrl || request.headers.get("x-spctre-forwarded-by") === "web") return null;

  const target = new URL("/api/token/refresh", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("x-request-id", traceId);
  headers.set("x-spctre-forwarded-by", "web");

  const idempotencyKey = extractIdempotencyKey(request);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  const response = await fetchWithTimeout(target, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
    timeoutMs: 15_000,
  });

  return withTraceId(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    traceId,
  );
}

export { handlePostApiTokenRefresh as POST };
