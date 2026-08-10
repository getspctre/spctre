import { describe, expect, it } from "vitest";
import {
  describeBlockingIssues,
  validatePolicyBundleLayers,
  validatePolicyRules,
} from "../src/bundle-validation";
import { POLICY_PACKS } from "../src/packs";
import type { PolicyRuleSummary } from "../src/types";

function rule(overrides: Partial<PolicyRuleSummary> = {}): PolicyRuleSummary {
  return {
    stableRuleId: "rule-1",
    title: "Rule",
    effect: "DENY",
    domains: [],
    connectors: ["stripe"],
    actions: ["charge"],
    immutable: false,
    ...overrides,
  } as PolicyRuleSummary;
}

describe("validatePolicyRules", () => {
  it("accepts an enforceable rule set", () => {
    expect(validatePolicyRules([rule()]).valid).toBe(true);
  });

  // Each of these produces a rule the evaluator can never match, with no error
  // at evaluation time — the policy reads as healthy and enforces nothing.
  it.each([
    [
      "an unsupported constraint operator",
      // Deliberately past the TypeScript union: an operator can reach the kernel
      // from an imported document or an older client, and must be reported.
      rule({
        parameterConstraints: [{ field: "amount", operator: "approximately" as never, value: 5 }],
      }),
      "unknown_operator",
    ],
    [
      "a comparison against a string",
      rule({
        parameterConstraints: [{ field: "amount", operator: "gte", value: "5000" as never }],
      }),
      "constraint_value_type",
    ],
    [
      "a wildcard in the middle of an action",
      rule({ actions: ["charge.*.refund"] }),
      "unsupported_wildcard",
    ],
    [
      "an empty semantic prompt",
      rule({ semanticChecks: [{ id: "s1", prompt: "" }] }),
      "empty_semantic_prompt",
    ],
  ])("rejects %s", (_label, offending, code) => {
    const validation = validatePolicyRules([offending as PolicyRuleSummary]);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain(code);
    expect(describeBlockingIssues(validation)).not.toBe("");
  });

  it("rejects a duplicate rule ID in one revision", () => {
    const validation = validatePolicyRules([rule(), rule({ title: "Other" })]);
    expect(validation.valid).toBe(false);
    expect(validation.issues[0].code).toBe("duplicate_rule_id");
    expect(validation.issues[0].stableRuleId).toBe("rule-1");
  });

  it("reports a match-everything rule as a warning, not a blocker", () => {
    const validation = validatePolicyRules([rule({ connectors: [], actions: [], domains: [] })]);
    expect(validation.valid).toBe(true);
    expect(validation.issues[0].severity).toBe("WARNING");
    expect(describeBlockingIssues(validation)).toBe("");
  });
});

describe("validatePolicyBundleLayers", () => {
  it("accepts an override of the same rule ID from a more specific layer", () => {
    const validation = validatePolicyBundleLayers([
      { scope: "ORGANIZATION", rules: [rule({ effect: "ALLOW" })] },
      { scope: "WORKSPACE", rules: [rule({ effect: "DENY" })] },
    ]);
    expect(validation.valid).toBe(true);
  });

  it("rejects layers whose order would invert precedence", () => {
    const validation = validatePolicyBundleLayers([
      { scope: "CONNECTOR", rules: [rule()] },
      { scope: "ORGANIZATION", rules: [rule({ stableRuleId: "rule-2" })] },
    ]);
    expect(validation.valid).toBe(false);
    expect(validation.issues[0].code).toBe("layer_order");
    expect(validation.issues[0].layerIndex).toBe(1);
  });
});

// The shipped packs are what a new workspace enforces on day one. If any of them
// contains an unenforceable rule, publish now refuses it.
describe("shipped policy packs", () => {
  it.each(POLICY_PACKS.map((pack) => [pack.connector, pack] as const))(
    "%s pack is enforceable",
    (_connector, pack) => {
      const validation = validatePolicyRules(pack.rules as PolicyRuleSummary[]);
      expect(describeBlockingIssues(validation)).toBe("");
      expect(validation.valid).toBe(true);
    },
  );
});
