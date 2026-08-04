import { normalizeNotionEvent } from "@/lib/domains/gateway/ingest";
import { makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter } from "@spctre/platform/metrics";
import { gatewayJsonError, handleRegisteredGatewayIngest } from "../_shared";
import { recordWebhookEventForReplayCheck } from "@/lib/repositories/gateway-webhook";

export const dynamic = "force-dynamic";

// Per-tenant rate limiter. In-memory is acceptable for rate limiting (best-effort
// per instance) — unlike replay detection, a miss here causes noise not a security
// hole. Maps tenantId → { count, resetTime }.
const RATE_LIMIT_TRACKER = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;

function validateWebhookTimestamp(timestamp: unknown, maxAgeMs = 300_000): boolean {
  if (!timestamp) return true;
  let t: number;
  if (typeof timestamp === "string") t = new Date(timestamp).getTime();
  else if (typeof timestamp === "number") t = timestamp;
  else return false;
  if (!Number.isFinite(t)) return false;
  const age = Date.now() - t;
  return age >= -5_000 && age <= maxAgeMs; // allow 5 s clock skew
}

function checkAndApplyRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const limiter = RATE_LIMIT_TRACKER.get(tenantId);
  if (!limiter || now >= limiter.resetTime) {
    RATE_LIMIT_TRACKER.set(tenantId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  limiter.count++;
  return limiter.count > RATE_LIMIT_MAX_REQUESTS;
}

async function handlePostApiGatewayIngestNotion(request: Request) {
  return handleRegisteredGatewayIngest({
    request,
    provider: "notion",
    providerHeader: "x-notion-signature",
    route: "/api/gateway-ingest/notion",
    spanName: "api.gateway-ingest.notion",
    defaultPrincipalId: "gateway:notion",
    invalidPayloadMessage:
      "Could not parse Notion event — missing required field 'id' or 'execution_id'.",
    normalize: normalizeNotionEvent,
    getEnvironment: (raw, request) =>
      String(
        objectField(raw, "metadata")?.environment ??
          request.headers.get("x-spctre-environment") ??
          "production",
      ),
    acceptDelegatedResponse: (response) => response.ok,
    afterAuth: ({ tenantId, traceId }) => {
      if (!checkAndApplyRateLimit(tenantId)) return null;
      incrementCounter("spctre.api.errors", 1, {
        "http.route": "/api/gateway-ingest/notion",
        "http.response.status_code": 429,
      });
      return gatewayJsonError(
        "Rate limit exceeded. Maximum 100 requests per minute.",
        429,
        traceId,
      );
    },
    beforeIngest: async ({ raw, event, tenantId, traceId }) => {
      const timestamp = raw.timestamp ?? raw.created_at ?? raw.event_timestamp;
      if (!validateWebhookTimestamp(timestamp)) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/gateway-ingest/notion",
          "http.response.status_code": 400,
        });
        return gatewayJsonError(
          "Webhook timestamp invalid or too old (max 5 minutes).",
          400,
          traceId,
        );
      }

      // Durable replay check persisted to Postgres so it survives restarts and
      // works correctly across multiple Cloud Run instances.
      const isNew = await recordWebhookEventForReplayCheck({
        eventId: event.gatewayEventId,
        tenantId,
        provider: "notion",
      });
      if (isNew) return null;

      incrementCounter("spctre.api.webhooks", 1, {
        "http.route": "/api/gateway-ingest/notion",
        reason: "replay_detected",
      });
      return withTraceId(
        Response.json(
          {
            decisionId: "cached",
            provenanceGap: false,
            deduplicated: true,
            meta: makeMeta(traceId),
          },
          { status: 200 },
        ),
        traceId,
      );
    },
  });
}

function objectField(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = obj[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export { handlePostApiGatewayIngestNotion as POST };
