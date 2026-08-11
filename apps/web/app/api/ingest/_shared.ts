import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import {
  ingestGenericEvidence,
  isGenericEvidenceIngestAvailable,
} from "@/lib/domains/evidence/generic-ingest-service";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { isRecord } from "@/lib/records";
import { logger } from "@spctre/platform/logging";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";
import { createHash } from "node:crypto";

export const MAX_REQUEST_BYTES = 1_048_576;
const evidenceRateLimit = 120;
const evidenceRateWindowSeconds = 60;
export type GenericProviderType =
  | "generic_json"
  | "generic_ndjson"
  | "cloudevents"
  | "otlp_logs"
  | "bedrock_agentcore"
  | "docker_ai_governance"
  | "langsmith";

export async function handleGenericRecords(params: {
  request: Request;
  providerType: GenericProviderType;
  records: Array<Record<string, unknown> | { error: string }>;
}) {
  const traceId = extractTraceId(params.request);
  if (!isGenericEvidenceIngestAvailable()) return error("Database not configured.", 503, traceId);
  const contentEncoding = params.request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity")
    return error("Compressed evidence payloads are not supported.", 415, traceId);
  if (Number(params.request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
    return error("Request body exceeds the 1 MiB limit.", 413, traceId);
  const integrationId = params.request.headers.get("x-spctre-integration-id");
  if (!integrationId) return error("x-spctre-integration-id is required.", 400, traceId);
  const auth = await authenticateServiceToken(params.request, "evidence:write");
  if (!auth.ok) return error("Missing or invalid service token.", 401, traceId);
  const results: Array<Record<string, unknown>> = [];
  for (let index = 0; index < params.records.length; index++) {
    const record = params.records[index]!;
    if ("error" in record) {
      results.push({ index, outcome: "rejected", error: record.error });
      continue;
    }
    try {
      const result = await ingestGenericEvidence({
        tenantId: auth.auth.tenantId,
        serviceTokenId: auth.auth.tokenId,
        integrationId,
        providerType: params.providerType,
        payload: record,
        actorId: auth.auth.principalId,
      });
      if (result.outcome === "not_found")
        return error("Unknown, inactive, or unauthorized integration.", 404, traceId);
      results.push({ index, ...result });
    } catch (caught) {
      logger.warn("Generic evidence record persistence failed", {
        error: caught instanceof Error ? caught.message : String(caught),
        providerType: params.providerType,
      });
      results.push({ index, outcome: "rejected", error: "Unable to persist this record." });
    }
  }
  const rejected = results.some((result) => result.outcome === "rejected");
  const accepted = results.some((result) => result.outcome === "accepted");
  return withTraceId(
    Response.json(
      { results, meta: makeMeta(traceId) },
      { status: rejected ? 207 : accepted ? 201 : 200 },
    ),
    traceId,
  );
}

export async function enforceEvidenceRateLimit(request: Request): Promise<Response | null> {
  const rateLimit = await checkEvidenceRateLimit(request);
  if (rateLimit.allowed) return null;
  const traceId = extractTraceId(request);
  return withTraceId(
    Response.json(
      {
        error: "Too many evidence records. Retry after the indicated delay.",
        meta: makeMeta(traceId),
      },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    ),
    traceId,
  );
}

async function checkEvidenceRateLimit(request: Request) {
  const credential =
    request.headers.get("authorization")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous";
  const digest = createHash("sha256").update(credential).digest("hex").slice(0, 32);
  return checkAuthRateLimit({
    key: `evidence-ingest:${digest}`,
    limit: evidenceRateLimit,
    windowSeconds: evidenceRateWindowSeconds,
  });
}

export async function readJsonRecord(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    const body = await readBoundedText(request);
    if (body instanceof Response) return body;
    const payload: unknown = JSON.parse(body);
    return isRecord(payload)
      ? payload
      : Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
}

export async function readBoundedText(request: Request): Promise<string | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
    return Response.json({ error: "Request body exceeds the 1 MiB limit." }, { status: 413 });
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return Response.json({ error: "Request body exceeds the 1 MiB limit." }, { status: 413 });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
export function error(message: string, status: number, traceId: string) {
  return withTraceId(
    Response.json({ error: message, meta: makeMeta(traceId) }, { status }),
    traceId,
  );
}
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
