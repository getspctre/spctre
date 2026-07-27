// Extract a displayable message from an unknown thrown value. Returns an empty
// string for non-Error values so callers can fall back to their own copy with
// `errorText(err) || "…"`. Safe to import from client components.
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "";
}
