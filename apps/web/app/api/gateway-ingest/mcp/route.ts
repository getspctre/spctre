import { revalidatePath } from "next/cache";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { type GatewayEventV1, type GatewayProvider } from "@/lib/domains/gateway/ingest";
import {
  isGatewayDatabaseConfigured,
  getTenantIdOrDemo,
  getWorkspaceIdOrDemo,
  ingestGatewayEvent,
} from "@/lib/domains/gateway/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set<GatewayProvider>(["portkey", "helicone", "litellm"]);

/**
 * Type-safe extraction of a non-negative numeric field with optional floor rounding.
 * Returns the validated number or fallback value if the field is invalid.
 */
function parseNonNegativeNumber(
  value: unknown,
  fallback: number,
  shouldFloor: boolean = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return shouldFloor ? Math.floor(value) : value;
}

/**
 * Type-safe extraction of a string field with trim.
 * Returns the string if non-empty after trim, otherwise returns null.
 */
function parseString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Type-safe extraction of a string array field.
 * Returns an array of strings, filtering out non-string elements.
 */
function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Type-safe extraction of a record/object field.
 * Returns the object if it's a plain object (not array), otherwise empty object.
 */
function parseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parsePayload(body: Record<string, unknown>): GatewayEventV1 | null {
  const provider = parseString(body.provider);
  if (!provider || !VALID_PROVIDERS.has(provider as GatewayProvider)) return null;

  const gatewayEventId = parseString(body.gateway_event_id);
  if (!gatewayEventId) return null;

  const agentId = parseString(body.agent_id);
  if (!agentId) return null;

  return {
    provider: provider as GatewayProvider,
    gatewayEventId,
    model: parseString(body.model) ?? "unknown",
    agentId,
    connector: parseString(body.connector) ?? "llm-gateway",
    action: parseString(body.action) ?? "llm_call",
    toolDeclarations: parseStringArray(body.tool_declarations),
    promptTokens: parseNonNegativeNumber(body.prompt_tokens, 0, true),
    completionTokens: parseNonNegativeNumber(body.completion_tokens, 0, true),
    latencyMs: parseNonNegativeNumber(body.latency_ms, 0, false),
    costUsd: parseNonNegativeNumber(body.cost_usd, NaN, false) || undefined,
    eventTimestamp: parseString(body.event_timestamp) ?? new Date().toISOString(),
    rawEvent: parseObject(body.raw_event),
  };
}

async function handlePostApiGatewayIngestMcp(request: Request) {
  const traceId = extractTraceId(request);

  return await withSpan(
    "api.gateway-ingest.mcp",
    { "http.route": "/api/gateway-ingest/mcp" },
    async () => {
      if (!isGatewayDatabaseConfigured()) {
        return withTraceId(
          Response.json(
            { error: "Database not configured.", meta: makeMeta(traceId) },
            { status: 503 },
          ),
          traceId,
        );
      }

      if (!hasBearerToken(request)) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/gateway-ingest/mcp",
          "http.response.status_code": 401,
        });
        return withTraceId(
          Response.json(
            { error: "Bearer token required.", meta: makeMeta(traceId) },
            { status: 401 },
          ),
          traceId,
        );
      }

      const tokenAuth = await authenticateServiceToken(request, "evidence:write");
      if (!tokenAuth.ok) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/gateway-ingest/mcp",
          "http.response.status_code": 401,
        });
        return withTraceId(
          Response.json(
            { error: "Invalid or expired service token.", meta: makeMeta(traceId) },
            { status: 401 },
          ),
          traceId,
        );
      }

      const tenantId = tokenAuth.auth.tenantId ?? getTenantIdOrDemo(null);
      const workspaceId = tokenAuth.auth.workspaceId ?? getWorkspaceIdOrDemo(null);
      const principalId = tokenAuth.auth.principalId ?? "gateway:mcp";

      let raw: Record<string, unknown>;
      try {
        raw = (await request.json()) as Record<string, unknown>;
      } catch {
        return withTraceId(
          Response.json(
            { error: "Request body must be JSON.", meta: makeMeta(traceId) },
            { status: 400 },
          ),
          traceId,
        );
      }

      const event = parsePayload(raw);
      if (!event) {
        return withTraceId(
          Response.json(
            {
              error:
                "Invalid payload. Required: provider (portkey|helicone|litellm), gateway_event_id, agent_id.",
              meta: makeMeta(traceId),
            },
            { status: 422 },
          ),
          traceId,
        );
      }

      try {
        const environment = typeof raw.environment === "string" ? raw.environment : "production";

        const result = await ingestGatewayEvent({
          event,
          tenantId,
          workspaceId: workspaceId ?? "",
          principalId,
          environment,
        });

        revalidatePath("/evidence");
        revalidatePath("/agents");

        return withTraceId(
          Response.json(
            {
              decisionId: result.decisionId,
              provenanceGap: result.provenanceGap,
              deduplicated: result.deduplicated,
              meta: makeMeta(traceId),
            },
            { status: result.deduplicated ? 200 : 201 },
          ),
          traceId,
        );
      } catch (err) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/gateway-ingest/mcp",
          "http.response.status_code": 500,
        });
        console.error("[gateway-ingest/mcp] ingest failed", err);
        return withTraceId(
          Response.json(
            { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
            { status: 500 },
          ),
          traceId,
        );
      }
    },
  );
}

export { handlePostApiGatewayIngestMcp as POST };
