import { describe, expect, it } from "vitest";
import { buildDraftSimulationSummary } from "../lib/domains/review/draft-simulation";
import type { PolicyRuleSummary } from "@spctre/policy-schema";

// A draft that newly escalates large Stripe refunds.
const DRAFT: PolicyRuleSummary[] = [
  {
    stableRuleId: "stripe.refund.high_value_review",
    title: "Escalate high-value refunds",
    effect: "ESCALATE",
    sourceFormat: "AGT_YAML",
    domains: [],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false,
    parameterConstraints: [{ field: "amount_cents", operator: "gte", value: 50000 }],
  },
];

function record(over: Partial<Parameters<typeof buildDraftSimulationSummary>[0][number]>) {
  return {
    decisionId: crypto.randomUUID(),
    connector: "stripe",
    action: "refund.create",
    status: "ALLOW" as const,
    toolParameters: {},
    ...over,
  };
}

describe("buildDraftSimulationSummary", () => {
  it("flags decisions whose outcome changes under the draft and buckets transitions", () => {
    const summary = buildDraftSimulationSummary(
      [
        record({ toolParameters: { amount_cents: 90000 }, status: "ALLOW" }), // → ESCALATE (changed)
        record({ toolParameters: { amount_cents: 80000 }, status: "ALLOW" }), // → ESCALATE (changed)
        record({ toolParameters: { amount_cents: 100 }, status: "ALLOW" }), // stays ALLOW (unchanged)
      ],
      DRAFT
    );

    expect(summary.sampled).toBe(3);
    expect(summary.changed).toBe(2);
    expect(summary.unchanged).toBe(1);
    expect(summary.transitions).toEqual([{ transition: "ALLOW→ESCALATE", count: 2 }]);
    expect(summary.findings).toHaveLength(2);
    expect(summary.findings[0].proposedStatus).toBe("ESCALATE");
  });

  it("reports no change when the recorded status already matches the draft decision", () => {
    const summary = buildDraftSimulationSummary(
      [record({ toolParameters: { amount_cents: 90000 }, status: "ESCALATE" })],
      DRAFT
    );
    expect(summary.changed).toBe(0);
    expect(summary.transitions).toEqual([]);
  });

  it("returns an empty summary for no evidence", () => {
    const summary = buildDraftSimulationSummary([], DRAFT);
    expect(summary).toEqual({ sampled: 0, unchanged: 0, changed: 0, indeterminate: 0, transitions: [], findings: [] });
  });

  describe("domain-scoped rules with unknown request domain", () => {
    const DOMAIN_SCOPED: PolicyRuleSummary[] = [{ ...DRAFT[0], domains: ["refunds"] }];

    it("marks a decision indeterminate instead of overstating a domain-scoped match", () => {
      const summary = buildDraftSimulationSummary(
        [record({ toolParameters: { amount_cents: 90000 }, status: "ALLOW" })],
        DOMAIN_SCOPED
      );
      // The refunds-scoped ESCALATE would match under the evaluator's empty-domain
      // wildcard, but evidence doesn't record the domain — so it's indeterminate,
      // not a definite ALLOW→ESCALATE change.
      expect(summary.indeterminate).toBe(1);
      expect(summary.changed).toBe(0);
      expect(summary.unchanged).toBe(0);
      expect(summary.transitions).toEqual([]);
    });

    it("still reports a definite change driven by a domain-agnostic rule alongside a domain-scoped one", () => {
      const rules: PolicyRuleSummary[] = [
        {
          stableRuleId: "stripe.refund.block",
          title: "Block refunds",
          effect: "DENY",
          sourceFormat: "AGT_YAML",
          domains: [], // domain-agnostic — applies regardless of request domain
          connectors: ["stripe"],
          actions: ["refund.create"],
          immutable: false,
        },
        ...DOMAIN_SCOPED, // refunds-scoped ESCALATE (lower precedence than DENY)
      ];
      const summary = buildDraftSimulationSummary(
        [record({ toolParameters: { amount_cents: 90000 }, status: "ALLOW" })],
        rules
      );
      // DENY wins regardless of the domain-scoped rule, so the change is definite.
      expect(summary.indeterminate).toBe(0);
      expect(summary.changed).toBe(1);
      expect(summary.findings[0].proposedStatus).toBe("DENY");
    });
  });
});
