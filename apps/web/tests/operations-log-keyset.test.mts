import { describe, it, expect, vi, beforeEach } from "vitest";

// Faithful flattening mock of the `postgres` tagged-template client. The real
// client composes a nested rawSql fragment interpolated as `${fragment}` into a
// parent `sql` template by splicing the fragment's SQL text and merging its bind
// params. This mock reproduces that composition and records the final query, so
// a repository test can prove the keyset predicate is actually interpolated into
// the WHERE clause. (Regression guard: an earlier revision built
// `keysetPredicate` but never spliced it in, so every Next/Prev cursor silently
// re-fetched the newest page.)

type Frag = { __frag: true; strings: readonly string[]; values: unknown[] };

let lastQuery: { text: string; params: unknown[] } | null = null;

function isFrag(v: unknown): v is Frag {
  return typeof v === "object" && v !== null && (v as Frag).__frag === true;
}

function flatten(strings: readonly string[], values: unknown[], acc: { text: string; params: unknown[] }): void {
  for (let i = 0; i < strings.length; i++) {
    acc.text += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (isFrag(v)) {
        flatten(v.strings, v.values, acc);
      } else {
        acc.params.push(v);
        acc.text += `$${acc.params.length}`;
      }
    }
  }
}

// `sql` tag: compose the whole query, record it, resolve to no rows.
function sqlTag(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const acc = { text: "", params: [] as unknown[] };
  flatten(strings as readonly string[], values, acc);
  lastQuery = acc;
  return Promise.resolve([]);
}

// `rawSql` tag: return a composable fragment marker; it must NOT execute on its
// own — it only contributes SQL text + binds when spliced into a parent query.
function rawSqlTag(strings: TemplateStringsArray, ...values: unknown[]): Frag {
  return { __frag: true, strings: strings as readonly string[], values };
}

vi.mock("@/lib/db", () => ({ sql: sqlTag, rawSql: rawSqlTag }));

const { listOperationsLogKeyset } = await import("../lib/repositories/operations-log/log");

const TENANT = "11111111-1111-1111-1111-111111111111";
const WORKSPACE = "22222222-2222-2222-2222-222222222222";
const CURSOR_TS = "2026-07-03T00:00:00.000Z";
const CURSOR_ID = "33333333-3333-3333-3333-333333333333";

function composed(): { text: string; params: unknown[] } {
  expect(lastQuery).not.toBeNull();
  return { text: lastQuery!.text.replace(/\s+/g, " ").trim(), params: lastQuery!.params };
}

beforeEach(() => {
  lastQuery = null;
});

describe("listOperationsLogKeyset applies the cursor predicate", () => {
  it("splices a descending (created_at <) predicate and its binds for a next cursor", async () => {
    await listOperationsLogKeyset(TENANT, WORKSPACE, {
      limit: 50,
      cursor: { ts: CURSOR_TS, id: CURSOR_ID, dir: "next" },
    });
    const { text, params } = composed();
    expect(text).toContain("created_at <");
    expect(text).toContain("id <");
    expect(text).toContain("ORDER BY created_at DESC, id DESC");
    // The cursor boundary values must actually reach the query as bind params.
    expect(params).toContain(CURSOR_TS);
    expect(params).toContain(CURSOR_ID);
  });

  it("splices an ascending (created_at >) predicate and its binds for a prev cursor", async () => {
    await listOperationsLogKeyset(TENANT, WORKSPACE, {
      limit: 50,
      cursor: { ts: CURSOR_TS, id: CURSOR_ID, dir: "prev" },
    });
    const { text, params } = composed();
    expect(text).toContain("created_at >");
    expect(text).toContain("id >");
    expect(text).toContain("ORDER BY created_at ASC, id ASC");
    expect(params).toContain(CURSOR_TS);
    expect(params).toContain(CURSOR_ID);
  });

  it("omits the keyset predicate on the first page (no cursor)", async () => {
    await listOperationsLogKeyset(TENANT, WORKSPACE, { limit: 50 });
    const { text, params } = composed();
    expect(text).not.toContain("created_at <");
    expect(text).not.toContain("created_at >");
    expect(params).not.toContain(CURSOR_TS);
  });

  it("still applies the eventType filter alongside the cursor predicate", async () => {
    await listOperationsLogKeyset(TENANT, WORKSPACE, {
      limit: 50,
      eventType: "POLICY_PUBLISHED" as never,
      cursor: { ts: CURSOR_TS, id: CURSOR_ID, dir: "next" },
    });
    const { text, params } = composed();
    expect(text).toContain("event_type =");
    expect(text).toContain("created_at <");
    expect(params).toContain("POLICY_PUBLISHED");
    expect(params).toContain(CURSOR_TS);
  });
});
