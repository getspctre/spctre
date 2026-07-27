import { z, ZodSchema } from "zod";
import type { ApiError } from "./envelope";

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = {
  ok: false;
  error: string;
  issues: Array<{ path: string; message: string }>;
};
export type ParseResult<T> = ParseOk<T> | ParseFail;

/**
 * Parse and validate an unknown value against a Zod schema.
 *
 * Returns a discriminated union so callers can handle errors without try/catch.
 */
export function parseBody<T>(schema: ZodSchema<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));

  const first = issues[0];
  const error = first
    ? first.path !== "(root)"
      ? `${first.path}: ${first.message}`
      : first.message
    : "Validation failed.";

  return {
    ok: false,
    error,
    issues,
  };
}

/** Re-export z so consumers don't need a direct zod dependency. */
export { z };
