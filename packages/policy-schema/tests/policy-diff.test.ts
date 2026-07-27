import { describe, it, expect } from "vitest";
import { diffPolicyRules } from "../src/index";
import type { PolicyRuleSummary } from "../src/index";

// A pack upgrade persists a new revision on the connector branch, so the review
// surface diffs it against its parent with diffPolicyRules — the *same*
// operational diff an authored rule revision produces. These tests lock that the
// diff actually surfaces the change classes a pack override touches, most
// importantly the typed parameter thresholds. If those were invisible to the
// diff, a pack upgrade that only moved a threshold would read as UNCHANGED: a
// silent replace, the opposite of the reviewable-diff contract.

const baseRule: PolicyRuleSummary = {
  stableRuleId: "stripe.refund.high_value_review",
  title: "Escalate high-value refunds for review",
  effect: "ESCALATE",
  sourceFormat: "AGT_YAML",
  domains: ["refunds", "payments"],
  connectors: ["stripe"],
  actions: ["refund.create"],
  immutable: false,
  parameterConstraints: [
    { field: "amount_cents", operator: "gte", value: 50000, parameterKey: "stripe.refund_review_threshold_cents" },
  ],
};

describe("diffPolicyRules — operational diff surface (shared by authored changes and pack upgrades)", () => {
  it("reports a parameter-threshold change as MODIFIED with parameterConstraints in changedFields", () => {
    const after: PolicyRuleSummary = {
      ...baseRule,
      parameterConstraints: [
        { field: "amount_cents", operator: "gte", value: 200000, parameterKey: "stripe.refund_review_threshold_cents" },
      ],
    };

    const diff = diffPolicyRules({
      branchId: "branch-stripe",
      baseRevisionId: "rev-1",
      compareRevisionId: "rev-2",
      before: [baseRule],
      after: [after],
    });

    expect(diff.summary).toMatchObject({ added: 0, removed: 0, modified: 1, unchanged: 0 });
    const ruleDiff = diff.rules.find((r) => r.stableRuleId === baseRule.stableRuleId);
    expect(ruleDiff?.status).toBe("MODIFIED");
    expect(ruleDiff?.changedFields).toContain("parameterConstraints");
    // The before/after are carried so the reviewer can read the exact threshold move.
    expect(ruleDiff?.before?.parameterConstraints?.[0]?.value).toBe(50000);
    expect(ruleDiff?.after?.parameterConstraints?.[0]?.value).toBe(200000);
  });

  it("reports an identical rule as UNCHANGED (no false positives)", () => {
    const diff = diffPolicyRules({
      branchId: "branch-stripe",
      baseRevisionId: "rev-1",
      compareRevisionId: "rev-2",
      before: [baseRule],
      after: [{ ...baseRule, parameterConstraints: [{ ...baseRule.parameterConstraints![0] }] }],
    });
    expect(diff.summary).toMatchObject({ modified: 0, unchanged: 1 });
    expect(diff.rules.find((r) => r.stableRuleId === baseRule.stableRuleId)?.status).toBe("UNCHANGED");
  });

  it("still classifies added / removed / effect-changed rules the same as an authored diff", () => {
    const diff = diffPolicyRules({
      branchId: "branch-stripe",
      baseRevisionId: "rev-1",
      compareRevisionId: "rev-2",
      before: [baseRule, { ...baseRule, stableRuleId: "stripe.legacy" }],
      after: [
        { ...baseRule, effect: "DENY" },
        { ...baseRule, stableRuleId: "stripe.new_rule" },
      ],
    });
    expect(diff.summary).toMatchObject({ added: 1, removed: 1, modified: 1 });
    expect(diff.rules.find((r) => r.stableRuleId === baseRule.stableRuleId)?.changedFields).toContain("effect");
    expect(diff.rules.find((r) => r.stableRuleId === "stripe.new_rule")?.status).toBe("ADDED");
    expect(diff.rules.find((r) => r.stableRuleId === "stripe.legacy")?.status).toBe("REMOVED");
  });
});
