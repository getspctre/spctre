// Stable, machine-readable error codes for domain-service failures. Per the
// localization strategy (§4A), the canonical/log-facing representation is the
// invariant code — presentation layers map the code to a localized string via
// the `errors` message namespace. This module is client-safe (no server-only
// imports) so mutation handlers can resolve codes at the render boundary.
export type ErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_WORKSPACE"
  | "PLAN_REQUIRED"
  | "POLICY_NOT_FOUND"
  | "LIMIT_EXCEEDED"
  | "POLICY_FILE_NOT_FOUND"
  | "UNKNOWN_CONNECTOR"
  | "UNKNOWN_ACTION";

const KNOWN_CODES = new Set<string>([
  "AUTH_REQUIRED",
  "INVALID_WORKSPACE",
  "PLAN_REQUIRED",
  "POLICY_NOT_FOUND",
  "LIMIT_EXCEEDED",
  "POLICY_FILE_NOT_FOUND",
  "UNKNOWN_CONNECTOR",
  "UNKNOWN_ACTION",
]);

// Error whose `message` is the stable code itself. Keeping message === code
// makes logs/audit trails carry the invariant identifier (not localized copy)
// and lets the code survive the Next.js server-action boundary in development,
// where the raw message is forwarded to the client.
export class CodedError extends Error {
  readonly code: ErrorCode;
  readonly meta?: Record<string, unknown>;

  constructor(code: ErrorCode, meta?: Record<string, unknown>) {
    super(code);
    this.name = "CodedError";
    this.code = code;
    this.meta = meta;
  }
}

// Recover a stable code from an arbitrary thrown/returned value: a CodedError
// instance, a plain `{ code }` (e.g. a JSON error envelope from an API route),
// or an Error whose message is a known code (server-action boundary in dev).
export function extractErrorCode(
  err: unknown
): { code: ErrorCode; meta?: Record<string, unknown> } | null {
  if (err && typeof err === "object") {
    const anyErr = err as { code?: unknown; meta?: unknown; message?: unknown };
    if (typeof anyErr.code === "string" && KNOWN_CODES.has(anyErr.code)) {
      return {
        code: anyErr.code as ErrorCode,
        meta:
          anyErr.meta && typeof anyErr.meta === "object"
            ? (anyErr.meta as Record<string, unknown>)
            : undefined,
      };
    }
    if (typeof anyErr.message === "string" && KNOWN_CODES.has(anyErr.message)) {
      return { code: anyErr.message as ErrorCode };
    }
  }
  return null;
}

// Resolve a thrown value to a display string. When a stable code is recognized,
// the localized `errors.<CODE>` message is used; otherwise the caller's
// localized `fallback` is returned so raw English domain copy is never shown to
// the user. `tErrors` must be a translator scoped to the `errors` namespace.
type ErrorTranslator = (
  key: string,
  values?: Record<string, string | number | Date>
) => string;

export function resolveErrorMessage(
  err: unknown,
  tErrors: ErrorTranslator,
  fallback: string
): string {
  const coded = extractErrorCode(err);
  if (coded) return tErrors(coded.code, coded.meta as Record<string, string | number | Date> | undefined);
  return fallback;
}
