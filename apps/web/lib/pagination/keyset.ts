// Keyset (cursor) pagination over append-heavy tables ordered newest-first by
// (created_at DESC, id DESC). Replaces LIMIT/OFFSET so deep pages don't scan and
// discard preceding rows, and concurrent inserts don't shift rows between pages.
// See database-optimizations-audit finding 7.
//
// A cursor names a boundary row (its created_at + id) plus the direction to walk:
//   - "next" = older rows (created_at DESC continues downward)
//   - "prev" = newer rows (walked ascending from the cursor, then reversed)
// First page has no cursor. Callers fetch `limit + 1` rows in the query's natural
// order and hand them to buildKeysetPage, which trims the probe row, restores
// newest-first display order, and derives the prev/next boundary cursors.

type KeysetDirection = "next" | "prev";

export interface KeysetCursor {
  ts: string; // created_at, ISO 8601
  id: string; // tie-breaker PK (uuid)
  dir: KeysetDirection;
}

export interface KeysetPage<T> {
  items: T[];
  nextCursor: string | null; // older rows; null when none
  prevCursor: string | null; // newer rows; null when on the first page
  hasNext: boolean;
  hasPrev: boolean;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

// The tie-breaker id is bound as `${cursor.id}::uuid`; a non-UUID would throw at
// the DB cast and degrade to an empty/fallback page. Reject it up front instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Defensive: any malformed/tampered cursor decodes to null (caller treats it as
// "first page") rather than throwing on a user-supplied query param.
export function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as KeysetCursor).ts === "string" &&
      typeof (parsed as KeysetCursor).id === "string" &&
      ((parsed as KeysetCursor).dir === "next" || (parsed as KeysetCursor).dir === "prev")
    ) {
      const c = parsed as KeysetCursor;
      // Reject an unparseable timestamp or non-UUID id so neither reaches the SQL
      // bind as garbage (the ::timestamptz / ::uuid casts would otherwise error).
      if (Number.isNaN(Date.parse(c.ts))) return null;
      if (!UUID_RE.test(c.id)) return null;
      return { ts: c.ts, id: c.id, dir: c.dir };
    }
  } catch {
    // fall through
  }
  return null;
}

// Given `limit + 1` rows in the query's natural order (DESC for "next"/first
// page, ASC for "prev"), produce a newest-first page and its boundary cursors.
export function buildKeysetPage<T>(
  fetched: T[],
  limit: number,
  cursor: KeysetCursor | null,
  boundary: (row: T) => { ts: string; id: string }
): KeysetPage<T> {
  const dir: KeysetDirection = cursor?.dir ?? "next";
  const overflow = fetched.length > limit;
  const trimmed = overflow ? fetched.slice(0, limit) : fetched;
  // "prev" walked ascending from the cursor; flip back to newest-first display.
  const items = dir === "prev" ? [...trimmed].reverse() : trimmed;

  // Walking older ("next"/first page): more older rows iff the probe row came
  // back. Newer rows exist iff we arrived here from somewhere newer (cursor set).
  // Walking newer ("prev"): the probe row signals more newer rows above; older
  // rows always exist because we came from there.
  const hasNext = dir === "prev" ? true : overflow;
  const hasPrev = dir === "prev" ? overflow : cursor != null;

  const newest = items.length > 0 ? boundary(items[0]) : null;
  const oldest = items.length > 0 ? boundary(items[items.length - 1]) : null;

  return {
    items,
    nextCursor: hasNext && oldest ? encodeCursor({ ts: oldest.ts, id: oldest.id, dir: "next" }) : null,
    prevCursor: hasPrev && newest ? encodeCursor({ ts: newest.ts, id: newest.id, dir: "prev" }) : null,
    hasNext,
    hasPrev,
  };
}
