import { authenticateServiceToken } from "@/lib/service-tokens";
import { recordAuthOperation, revokeBearerServiceToken } from "@/lib/domains/auth/service";
import { evidenceIngestUrl } from "@/lib/platform/config";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";

import { extractTraceId, withTraceId } from "@spctre/api-contracts";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const ROUTE_PATH = "/api/token/revoke";

async function handlePostApiTokenRevoke(request: Request) {
  const traceId = extractTraceId(request);
  const started = Date.now();
  const spanAttrs = { 
    "spctre.request_id": traceId, 
    "http.route": ROUTE_PATH, 
    "spctre.trace_id": traceId 
  };

  return await withSpan("api.token.revoke", spanAttrs, async () => {
  const delegated = await delegateTokenRevokeToWorker(request, traceId);
  if (delegated) return delegated;

  const auth = await authenticateServiceToken(request, "bundle:read");
  if (!auth.ok) {
    incrementCounter("spctre.api.errors", 1, { ...spanAttrs, "http.response.status_code": "401" });
    return withTraceId(Response.json({ error: auth.error }, { status: 401 }), traceId);
  }

  const { tokenId } = auth.auth;
  const revokeResult = await revokeBearerServiceToken(tokenId);
  if (revokeResult === "db-unavailable") {
    incrementCounter("spctre.api.errors", 1, { ...spanAttrs, "http.response.status_code": "503" });
    return withTraceId(Response.json({ error: "Database not configured." }, { status: 503 }), traceId);
  }

  recordAuthOperation({
    tenantId: auth.auth.tenantId,
    workspaceId: auth.auth.workspaceId,
    eventType: "TOKEN_REVOKED",
    sourceId: tokenId,
    sourceTable: "service_token",
    actorId: auth.auth.principalId,
    payload: { tokenId, revokedAt: new Date().toISOString() },
  }).catch(swallow("recordAuthOperation", undefined));

  incrementCounter("spctre.token.revoke", 1, { outcome: "success" });
  recordDuration("spctre.token.revoke.duration", Date.now() - started, { "http.route": ROUTE_PATH });
  return withTraceId(new Response(null, { status: 204 }), traceId);
  });
}

async function delegateTokenRevokeToWorker(request: Request, traceId: string): Promise<Response | null> {
  const baseUrl = evidenceIngestUrl();
  if (!baseUrl || request.headers.get("x-spctre-forwarded-by") === "web") return null;

  const target = new URL("/api/token/revoke", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers = new Headers(request.headers);
  headers.set("x-request-id", traceId);
  headers.set("x-spctre-forwarded-by", "web");
  headers.delete("host");
  headers.delete("content-length");

  const response = await fetchWithTimeout(target, {
    method: "POST",
    headers,
    cache: "no-store",
    timeoutMs: 15_000,
  });

  return withTraceId(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    traceId
  );
}

export { handlePostApiTokenRevoke as POST };
