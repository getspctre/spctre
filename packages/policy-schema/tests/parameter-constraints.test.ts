import { describe, it, expect } from "vitest";
import { applyPackParameterOverrides, evaluateDecision } from "../src/index";
import type { PolicyRuleSummary } from "../src/index";

describe("evaluateDecision with parameterConstraints", () => {
  const baseRule: PolicyRuleSummary = {
    stableRuleId: "test.refund.high_value_review",
    title: "Escalate high-value refunds",
    effect: "ESCALATE",
    sourceFormat: "SPCTRE_MANAGED",
    domains: ["refunds"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false,
    parameterConstraints: [
      { field: "amount_cents", operator: "gte", value: 50000, parameterKey: "test.threshold" },
    ],
  };

  it("escalates when the parameter constraint matches", () => {
    const result = evaluateDecision({
      connector: "stripe",
      action: "refund.create",
      domains: ["refunds"],
      rules: [baseRule],
      toolParameters: { amount_cents: 75000 },
    });
    expect(result.status).toBe("ESCALATE");
    expect(result.matchedRefs).toContain("test.refund.high_value_review");
  });

  it("does not match when the parameter constraint fails", () => {
    const result = evaluateDecision({
      connector: "stripe",
      action: "refund.create",
      domains: ["refunds"],
      rules: [baseRule],
      toolParameters: { amount_cents: 100 },
    });
    expect(result.status).toBe("ALLOW");
    expect(result.matchedRefs).not.toContain("test.refund.high_value_review");
  });
});

describe("applyPackParameterOverrides", () => {
  const rules: PolicyRuleSummary[] = [
    {
      stableRuleId: "test.refund.high_value_review",
      title: "Escalate high-value refunds",
      effect: "ESCALATE",
      sourceFormat: "SPCTRE_MANAGED",
      domains: ["refunds"],
      connectors: ["stripe"],
      actions: ["refund.create"],
      immutable: false,
      parameterConstraints: [
        { field: "amount_cents", operator: "gte", value: 50000, parameterKey: "test.threshold" },
      ],
    },
  ];

  it("substitutes an override value by parameterKey without mutating the original rules", () => {
    const overridden = applyPackParameterOverrides(rules, { "test.threshold": 200000 });
    expect(overridden[0].parameterConstraints?.[0].value).toBe(200000);
    expect(rules[0].parameterConstraints?.[0].value).toBe(50000);
  });

  it("is a no-op when there are no matching overrides", () => {
    const overridden = applyPackParameterOverrides(rules, { "unrelated.key": 1 });
    expect(overridden[0].parameterConstraints?.[0].value).toBe(50000);
  });

  it("returns the same array reference when overrides are empty", () => {
    expect(applyPackParameterOverrides(rules, {})).toBe(rules);
  });
});
