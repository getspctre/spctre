import { describe, it, expect } from "vitest";
import {
  evaluateParameterConstraints,
  applyPackParameterOverrides,
  evaluateDecision,
} from "../src/index";
import type { PolicyRuleSummary } from "../src/index";

describe("evaluateParameterConstraints", () => {
  it("matches a single gte constraint", () => {
    expect(
      evaluateParameterConstraints([{ field: "amount_cents", operator: "gte", value: 50000 }], {
        amount_cents: 75000,
      }).matched,
    ).toBe(true);

    expect(
      evaluateParameterConstraints([{ field: "amount_cents", operator: "gte", value: 50000 }], {
        amount_cents: 100,
      }).matched,
    ).toBe(false);
  });

  it("ANDs multiple constraints, matching only when every one holds", () => {
    const constraints = [
      { field: "ref", operator: "in" as const, value: ["main", "master"] },
      { field: "force", operator: "eq" as const, value: true },
    ];
    expect(evaluateParameterConstraints(constraints, { ref: "main", force: true }).matched).toBe(
      true,
    );
    expect(evaluateParameterConstraints(constraints, { ref: "main", force: false }).matched).toBe(
      false,
    );
    expect(
      evaluateParameterConstraints(constraints, { ref: "feature/x", force: true }).matched,
    ).toBe(false);
  });

  it("resolves dot-path nested fields", () => {
    expect(
      evaluateParameterConstraints([{ field: "branch.protected", operator: "eq", value: true }], {
        branch: { protected: true },
      }).matched,
    ).toBe(true);
  });

  it("supports contains and not_in operators", () => {
    expect(
      evaluateParameterConstraints(
        [{ field: "destination_cluster", operator: "contains", value: "prod" }],
        { destination_cluster: "prod-us-east" },
      ).matched,
    ).toBe(true);
    expect(
      evaluateParameterConstraints(
        [{ field: "environment", operator: "not_in", value: ["staging"] }],
        { environment: "production" },
      ).matched,
    ).toBe(true);
  });

  it("returns the constraint effect override when matched", () => {
    const result = evaluateParameterConstraints(
      [{ field: "amount_cents", operator: "gte", value: 50000, effect: "ESCALATE" }],
      { amount_cents: 75000 },
    );
    expect(result.matched).toBe(true);
    expect(result.effectOverride).toBe("ESCALATE");
  });

  it("returns not matched for an empty constraint list", () => {
    expect(evaluateParameterConstraints([], {}).matched).toBe(false);
  });
});

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
