import { randomUUID } from "node:crypto";

const TRACE_HEADER = "x-request-id";
const IDEMPOTENCY_HEADER = "x-idempotency-key";

/**
 * Extract the trace/correlation ID from an incoming request.
 * Falls back to a freshly generated UUID if the header is absent.
 */
export function extractTraceId(request: Request): string {
  return (request.headers.get(TRACE_HEADER) ?? "").trim() || randomUUID();
}

/**
 * Extract the client-supplied idempotency key from an incoming request.
 * Returns null when the header is absent.
 */
export function extractIdempotencyKey(request: Request): string | null {
  const raw = (request.headers.get(IDEMPOTENCY_HEADER) ?? "").trim();
  return raw || null;
}

/**
 * Return a new trace ID.
 */
export function newTraceId(): string {
  return randomUUID();
}

/**
 * Attach the trace-ID to an existing Response as X-Request-ID.
 * Returns the same response object with the header added.
 */
export function withTraceId(response: Response, traceId: string): Response {
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}
