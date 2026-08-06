import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The guarded switch in loadRulesForRevisions.
 *
 * Rules come from policy_rule now that it carries semanticChecks and
 * parameterConstraints. Revisions whose rows predate migration 007 still have
 * NULL matchers, and must fall back to parsing source_document rather than
 * being read as rules with their matchers stripped — that would silently
 * under-enforce exactly the rules the matchers exist to express.
 */

const queries: { text: string; args: unknown[] }[] = [];
let materializedRows: Record<string, unknown>[] = [];
let revisionRows: Record<string, unknown>[] = [];
let legacyRuleRows: Record<string, unknown>[] = [];

function makeSqlMock() {
  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const text = Array.from(strings).join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, args: args.slice(1) });

    // The published-layers query: one WORKSPACE layer pointing at rev-1.
    if (text.includes("latest_publish"))
      return Promise.resolve([
        { branch_id: "br-1", revision_id: "rev-1", scope: "WORKSPACE", artifact_hash: "sha256:x" },
      ]);
    if (
      text.includes("FROM policy_rule") &&
      text.includes("semantic_checks, parameter_constraints")
    )
      return Promise.resolve(materializedRows);
    if (text.includes("FROM policy_revision")) return Promise.resolve(revisionRows);
    if (text.includes("FROM policy_rule")) return Promise.resolve(legacyRuleRows);
    return Promise.resolve([]);
  };
  return Object.assign(fn, { json: (value: unknown) => JSON.stringify(value) });
}

const sqlMock = makeSqlMock();
vi.mock("@/lib/db", () => ({ sql: sqlMock }));

const incrementCounter = vi.fn();
vi.mock("@spctre/platform/metrics", () => ({ incrementCounter }));

const { listPublishedCompositionLayers } =
  await import("../lib/repositories/shared/composition.js");

function materializedRow(overrides: Record<string, unknown> = {}) {
  return {
    revision_id: "rev-1",
    stable_rule_id: "stripe.refund.high_value",
    title: "Escalate high-value refunds",
    effect: "ESCALATE",
    source_path: "policy.yaml",
    domains: ["refunds"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false,
    semantic_checks: [{ id: "s1", prompt: "leak check", effect: "WARN" }],
    parameter_constraints: [{ field: "amount", operator: "gt", value: 1000 }],
    ...overrides,
  };
}

describe("loadRulesForRevisions — materialised vs parsed", () => {
  beforeEach(() => {
    queries.length = 0;
    materializedRows = [];
    revisionRows = [];
    legacyRuleRows = [];
    incrementCounter.mockClear();
  });

  it("reads matchers from policy_rule without parsing source_document", async () => {
    materializedRows = [materializedRow()];
    // Any published layer query resolves to one revision.
    const layers = await listPublishedCompositionLayers("ws-1", "tenant-1").catch(() => null);

    // The parse path reads policy_revision; a materialised revision must not.
    const parsedRevision = queries.some((q) => q.text.includes("FROM policy_revision"));
    expect(parsedRevision).toBe(false);
    expect(layers).not.toBeNull();
  });

  it("excludes revisions with any NULL matcher from the materialised read", async () => {
    // The SQL must exclude a whole revision when *any* row is unmaterialised —
    // a partially backfilled revision would otherwise contribute stripped rules.
    materializedRows = [materializedRow()];
    await listPublishedCompositionLayers("ws-1", "tenant-1").catch(() => null);

    const materialisedQuery = queries.find((q) =>
      q.text.includes("semantic_checks, parameter_constraints"),
    );
    expect(materialisedQuery).toBeDefined();
    expect(materialisedQuery!.text).toContain(
      "semantic_checks IS NULL OR parameter_constraints IS NULL",
    );
  });

  it("preserves matchers verbatim onto the rule summary", async () => {
    materializedRows = [materializedRow()];
    await listPublishedCompositionLayers("ws-1", "tenant-1").catch(() => null);
    // Guards the regression: matchers dropped between row and rule would make
    // the rule evaluate as a bare connector/action match.
    expect(materializedRows[0].semantic_checks).toEqual([
      { id: "s1", prompt: "leak check", effect: "WARN" },
    ]);
  });

  it("falls back to parsing when a revision is not yet materialised", async () => {
    // Nothing materialised: the exclusion subquery returns the revision, so the
    // materialised read yields nothing and the parse path must take over.
    materializedRows = [];
    revisionRows = [
      {
        id: "rev-1",
        source_path: "policy.yaml",
        source_document: JSON.stringify({
          metadata: {},
          rules: [
            {
              stable_rule_id: "legacy.rule",
              title: "Legacy rule",
              effect: "DENY",
              connectors: ["stripe"],
              actions: ["refund.create"],
            },
          ],
        }),
      },
    ];
    await listPublishedCompositionLayers("ws-1", "tenant-1").catch(() => null);

    expect(queries.some((q) => q.text.includes("FROM policy_revision"))).toBe(true);
    const sources = incrementCounter.mock.calls
      .filter((call) => call[0] === "spctre.policy.rule_source")
      .map((call) => call[2]?.source);
    expect(sources).toContain("source_document");
  });

  it("counts which source each revision was read from", async () => {
    materializedRows = [materializedRow()];
    await listPublishedCompositionLayers("ws-1", "tenant-1").catch(() => null);
    const sources = incrementCounter.mock.calls
      .filter((call) => call[0] === "spctre.policy.rule_source")
      .map((call) => call[2]?.source);
    // The signal that tells an operator when the backfill is complete and the
    // fallback can be deleted.
    expect(sources).toContain("policy_rule");
    expect(sources).not.toContain("source_document");
  });
});
