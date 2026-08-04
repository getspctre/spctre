import { describe, it, expect } from "vitest";
import {
  buildKeysetPage,
  decodeCursor,
  encodeCursor,
  type KeysetCursor,
} from "../lib/pagination/keyset";

type Row = { ts: string; id: string };

// Newest-first dataset (r1 newest ... r5 oldest), distinct timestamps.
const ROWS: Row[] = [
  { ts: "2026-07-05T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000001" },
  { ts: "2026-07-04T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000002" },
  { ts: "2026-07-03T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000003" },
  { ts: "2026-07-02T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000004" },
  { ts: "2026-07-01T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000005" },
];

// Mirrors the SQL: apply the keyset predicate + direction ordering, fetch limit+1.
function simulateQuery(cursor: KeysetCursor | null, limit: number): Row[] {
  const cmp = (a: Row, b: { ts: string; id: string }) => {
    const t = Date.parse(a.ts) - Date.parse(b.ts);
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const ascending = cursor?.dir === "prev";
  let rows = [...ROWS];
  if (cursor) {
    rows = rows.filter((r) => (ascending ? cmp(r, cursor) > 0 : cmp(r, cursor) < 0));
  }
  rows.sort((a, b) => (ascending ? cmp(a, b) : -cmp(a, b)));
  return rows.slice(0, limit + 1);
}

function page(cursor: KeysetCursor | null, limit = 2) {
  const fetched = simulateQuery(cursor, limit);
  return buildKeysetPage(fetched, limit, cursor, (r) => r);
}

describe("keyset cursor encode/decode", () => {
  it("round-trips a cursor", () => {
    const c: KeysetCursor = {
      ts: "2026-07-01T00:00:00.000Z",
      id: "33333333-3333-3333-3333-333333333333",
      dir: "next",
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("returns null for empty, malformed, or tampered cursors", () => {
    const uuid = "33333333-3333-3333-3333-333333333333";
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64-json!!")).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(`{"ts":"2026-07-01T00:00:00.000Z","id":"${uuid}","dir":"sideways"}`).toString(
          "base64url",
        ),
      ),
    ).toBeNull();
    // unparseable timestamp is rejected
    expect(
      decodeCursor(Buffer.from(`{"ts":"nope","id":"${uuid}","dir":"next"}`).toString("base64url")),
    ).toBeNull();
    // non-UUID id is rejected before it can reach the ${cursor.id}::uuid SQL cast
    expect(
      decodeCursor(
        Buffer.from('{"ts":"2026-07-01T00:00:00.000Z","id":"abc","dir":"next"}').toString(
          "base64url",
        ),
      ),
    ).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(
          `{"ts":"2026-07-01T00:00:00.000Z","id":"'; DROP TABLE x;--","dir":"next"}`,
        ).toString("base64url"),
      ),
    ).toBeNull();
  });
});

describe("keyset pagination round-trip", () => {
  it("walks forward, then back, hitting the same page boundaries", () => {
    // Page 1 (no cursor): newest two, next available, no prev.
    const p1 = page(null);
    expect(p1.items.map((r) => r.id)).toEqual(["...1", "...2"].map(sfx));
    expect(p1.hasPrev).toBe(false);
    expect(p1.hasNext).toBe(true);
    expect(p1.prevCursor).toBeNull();

    // Page 2 (next from p1).
    const p2 = page(decodeCursor(p1.nextCursor));
    expect(p2.items.map((r) => r.id)).toEqual(["...3", "...4"].map(sfx));
    expect(p2.hasPrev).toBe(true);
    expect(p2.hasNext).toBe(true);

    // Page 3 (next from p2): last row only, no further next.
    const p3 = page(decodeCursor(p2.nextCursor));
    expect(p3.items.map((r) => r.id)).toEqual(["...5"].map(sfx));
    expect(p3.hasPrev).toBe(true);
    expect(p3.hasNext).toBe(false);
    expect(p3.nextCursor).toBeNull();

    // Prev from p3 returns exactly page 2's rows in newest-first order.
    const back2 = page(decodeCursor(p3.prevCursor));
    expect(back2.items.map((r) => r.id)).toEqual(p2.items.map((r) => r.id));
    expect(back2.hasNext).toBe(true);
    expect(back2.hasPrev).toBe(true);

    // Prev from page 2 returns page 1's rows and reports first page (no prev).
    const back1 = page(decodeCursor(back2.prevCursor));
    expect(back1.items.map((r) => r.id)).toEqual(p1.items.map((r) => r.id));
    expect(back1.hasPrev).toBe(false);
    expect(back1.prevCursor).toBeNull();
  });

  it("handles an exact-multiple last page (no dangling empty page)", () => {
    // limit 5 over 5 rows: one full page, no next.
    const only = page(null, 5);
    expect(only.items).toHaveLength(5);
    expect(only.hasNext).toBe(false);
    expect(only.hasPrev).toBe(false);
    expect(only.nextCursor).toBeNull();
  });

  it("returns empty page info for no rows", () => {
    const empty = buildKeysetPage<Row>([], 10, null, (r) => r);
    expect(empty.items).toHaveLength(0);
    expect(empty.hasNext).toBe(false);
    expect(empty.hasPrev).toBe(false);
    expect(empty.nextCursor).toBeNull();
    expect(empty.prevCursor).toBeNull();
  });
});

function sfx(s: string): string {
  return `00000000-0000-0000-0000-00000000000${s.slice(-1)}`;
}
