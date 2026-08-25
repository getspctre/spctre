import { timingSafeEqual } from "node:crypto";

/**
 * Compare a presented secret against the expected one without leaking, through
 * response timing, how many leading bytes matched.
 *
 * The length check is not a leak worth avoiding: these secrets are fixed-length
 * per deployment, and `timingSafeEqual` throws on a length mismatch.
 */
export function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify an `Authorization: Bearer <secret>` header against a shared secret.
 *
 * Used by the internal, service-to-service routes. These are excused from the
 * proxy's session gate, so this comparison is the whole gate.
 */
export function bearerSecretMatches(
  authHeader: string | null | undefined,
  expected: string,
): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return secretMatches(authHeader.slice("Bearer ".length), expected);
}
