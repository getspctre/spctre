/**
 * Generic collection helpers. Kept out of any domain service so that pure,
 * reusable utilities do not accrete inside business logic.
 */

/** Shallow, order-sensitive equality for two string arrays. */
export function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
