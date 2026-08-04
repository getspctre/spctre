import { evidenceIngestUrl } from "@/lib/platform/config";
import { fetchWithRetry } from "@/lib/platform/fetch-retry";
import { withTraceId } from "@spctre/api-contracts";

export async function delegateToGoIngestor(
  request: Request,
  traceId: string,
): Promise<Response | null> {
  const baseUrl = evidenceIngestUrl();
  if (!baseUrl || request.headers.get("x-spctre-forwarded-by") === "web") {
    return null;
  }

  const target = new URL("/api/evidence", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers = new Headers(request.headers);
  headers.set("x-request-id", traceId);
  headers.set("x-spctre-forwarded-by", "web");
  headers.delete("host");
  headers.delete("content-length");

  // Retry-safe: the worker dedups on (tenant_id, decision_id).
  const response = await fetchWithRetry(target, {
    method: "POST",
    headers,
    body: await request.text(),
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
