import { evidenceIngestUrl, workerInternalSecret } from "@/lib/platform/config";
import { fetchWithRetry } from "@/lib/platform/fetch-retry";
import { isGatewayDatabaseConfigured, ingestGatewayEvent } from "@/lib/domains/gateway/service";
import {
  GatewayEventValidationError,
  type GatewayEventV1,
  type GatewayProvider,
} from "@/lib/domains/gateway/ingest";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { revalidatePath } from "next/cache";
import {
  resolveWebhookRegistrationBySecret,
  type ResolvedWebhookAuth,
  type WebhookProvider,
} from "@/lib/repositories/gateway-webhook";

/**
 * Attempt to authenticate an inbound gateway webhook by looking up the secret
 * in the gateway_webhook_registration table. Tenant and workspace are derived
 * from the DB row — callers must not trust x-spctre-tenant-id /
 * x-spctre-workspace-id headers when using webhook auth.
 *
 * Returns null when the secret is missing, unknown, or revoked.
 *
 * Falls back to SPCTRE_GATEWAY_WEBHOOK_SECRET for deployments that have not
 * yet migrated to per-integration registrations. The fallback is deprecated:
 * it still requires the new DB row to exist so that tenant/workspace are always
 * derived from the database, never from caller-supplied headers.
 */
export async function resolveWebhookRegistration(
  request: Request,
  providerHeader: string,
  expectedProvider: WebhookProvider,
): Promise<ResolvedWebhookAuth | null> {
  const secret =
    request.headers.get(providerHeader) ?? request.headers.get("x-spctre-gateway-secret") ?? "";
  if (!secret) return null;
  const registration = await resolveWebhookRegistrationBySecret(secret);
  if (!registration || registration.provider !== expectedProvider) return null;
  return registration;
}

async function delegateGatewayIngestToWorker(params: {
  provider: "portkey" | "helicone" | "litellm" | "notion";
  tenantId: string;
  workspaceId: string;
  principalId: string;
  environment: string;
  raw: Record<string, unknown>;
  traceId: string;
}): Promise<Response | null> {
  const baseUrl = evidenceIngestUrl();
  const secret = workerInternalSecret();
  if (!baseUrl || !secret) return null;

  const target = new URL(
    `/api/gateway-ingest/${params.provider}`,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  // Retry-safe: gateway ingest dedups per event on the worker side.
  const response = await fetchWithRetry(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": params.traceId,
      "x-spctre-internal-secret": secret,
      "x-spctre-tenant-id": params.tenantId,
      "x-spctre-workspace-id": params.workspaceId,
      "x-spctre-actor-id": params.principalId,
    },
    body: JSON.stringify({ environment: params.environment, raw: params.raw }),
    cache: "no-store",
    timeoutMs: 15_000,
  });

  return withTraceId(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    params.traceId,
  );
}

type GatewayIngestAuthContext = {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  traceId: string;
};

type GatewayIngestParsedContext = GatewayIngestAuthContext & {
  raw: Record<string, unknown>;
  event: GatewayEventV1;
};

export async function handleRegisteredGatewayIngest(params: {
  request: Request;
  provider: Exclude<GatewayProvider, "mcp">;
  providerHeader: string;
  route: string;
  spanName: string;
  defaultPrincipalId: string;
  invalidPayloadMessage: string;
  normalize: (raw: Record<string, unknown>) => GatewayEventV1 | null;
  getEnvironment: (raw: Record<string, unknown>, request: Request) => string;
  afterAuth?: (ctx: GatewayIngestAuthContext) => Response | null | Promise<Response | null>;
  beforeIngest?: (ctx: GatewayIngestParsedContext) => Response | null | Promise<Response | null>;
  acceptDelegatedResponse?: (response: Response) => boolean;
}) {
  const traceId = extractTraceId(params.request);

  return await withSpan(params.spanName, { "http.route": params.route }, async () => {
    if (!isGatewayDatabaseConfigured()) {
      return gatewayJsonError("Database not configured.", 503, traceId);
    }

    const auth = await resolveGatewayIngestAuth({
      request: params.request,
      provider: params.provider,
      providerHeader: params.providerHeader,
      route: params.route,
      defaultPrincipalId: params.defaultPrincipalId,
      traceId,
    });
    if (auth instanceof Response) return auth;

    const afterAuthResponse = await params.afterAuth?.({ ...auth, traceId });
    if (afterAuthResponse) return afterAuthResponse;

    const raw = await readJsonBody(params.request, traceId);
    if (raw instanceof Response) return raw;

    let event: GatewayEventV1 | null;
    try {
      event = params.normalize(raw);
    } catch (err) {
      if (err instanceof GatewayEventValidationError) {
        return gatewayValidationError(params.route, traceId, err);
      }
      throw err;
    }
    if (!event) {
      return gatewayJsonError(params.invalidPayloadMessage, 422, traceId);
    }

    const parsedContext = { ...auth, traceId, raw, event };
    const beforeIngestResponse = await params.beforeIngest?.(parsedContext);
    if (beforeIngestResponse) return beforeIngestResponse;

    try {
      const environment = params.getEnvironment(raw, params.request);
      const delegated = await delegateGatewayIngestToWorker({
        provider: params.provider,
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        principalId: auth.principalId,
        environment,
        raw,
        traceId,
      });

      if (delegated && (params.acceptDelegatedResponse?.(delegated) ?? true)) {
        revalidateGatewayViews();
        return delegated;
      }

      const result = await ingestGatewayEvent({
        event,
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        principalId: auth.principalId,
        environment,
      });

      revalidateGatewayViews();

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
        "http.route": params.route,
        "http.response.status_code": 500,
      });
      console.error(`[gateway-ingest/${params.provider}] ingest failed`, err);
      return gatewayJsonError("Service temporarily unavailable.", 500, traceId);
    }
  });
}

async function resolveGatewayIngestAuth(params: {
  request: Request;
  provider: Exclude<GatewayProvider, "mcp">;
  providerHeader: string;
  route: string;
  defaultPrincipalId: string;
  traceId: string;
}): Promise<GatewayIngestAuthContext | Response> {
  const webhookAuth = await resolveWebhookRegistration(
    params.request,
    params.providerHeader,
    params.provider,
  );
  if (webhookAuth) {
    return {
      tenantId: webhookAuth.tenantId,
      workspaceId: webhookAuth.workspaceId,
      principalId: params.defaultPrincipalId,
      traceId: params.traceId,
    };
  }

  if (!hasBearerToken(params.request)) {
    incrementCounter("spctre.api.errors", 1, {
      "http.route": params.route,
      "http.response.status_code": 401,
    });
    return gatewayJsonError(
      "Missing or invalid gateway webhook secret or bearer token.",
      401,
      params.traceId,
    );
  }

  const tokenAuth = await authenticateServiceToken(params.request, "evidence:write");
  if (!tokenAuth.ok) {
    incrementCounter("spctre.api.errors", 1, {
      "http.route": params.route,
      "http.response.status_code": 401,
    });
    return gatewayJsonError("Invalid or expired service token.", 401, params.traceId);
  }

  return {
    tenantId: tokenAuth.auth.tenantId,
    workspaceId: tokenAuth.auth.workspaceId,
    principalId: tokenAuth.auth.principalId,
    traceId: params.traceId,
  };
}

async function readJsonBody(
  request: Request,
  traceId: string,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return gatewayJsonError("Request body must be JSON.", 400, traceId);
  }
}

export function gatewayJsonError(
  error: string,
  status: number,
  traceId: string,
  issues?: Array<{ path: string; message: string }>,
): Response {
  return withTraceId(
    Response.json({ error, issues, meta: makeMeta(traceId) }, { status }),
    traceId,
  );
}

function gatewayValidationError(
  route: string,
  traceId: string,
  error: GatewayEventValidationError,
): Response {
  incrementCounter("spctre.api.errors", 1, {
    "http.route": route,
    "http.response.status_code": 422,
  });
  console.warn("[gateway-ingest] normalized event validation failed", {
    route,
    issues: error.issues,
  });
  return gatewayJsonError("Invalid normalized gateway event.", 422, traceId, error.issues);
}

function revalidateGatewayViews() {
  revalidatePath("/evidence");
  revalidatePath("/agents");
}
