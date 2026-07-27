import { describe, expect, it } from "vitest";
import { parseRulesPayload, unmodeledRuleFieldsMatch } from "../lib/domains/review/rule-authoring";

// Guards the lossless write path: parseRulesPayload -> normalizeRuleAuthoringInput
// must preserve typed parameterConstraints, controlMappings, and unmodeled
// (AGT-native / provenance) fields. Dropping any of these silently degrades
// runtime enforcement or compliance provenance on every commit.
describe("parseRulesPayload lossless normalization", () => {
  it("preserves parameter constraints, control mappings, and unmodeled fields", () => {
    const payload = JSON.stringify([
      {
        stableRuleId: "stripe.refund.high_value_review",
        title: "Escalate high-value refunds",
        effect: "ESCALATE",
        domains: ["refunds"],
        connectors: ["stripe"],
        actions: ["refund.create"],
        immutable: false,
        parameterConstraints: [
          {
            field: "amount_cents",
            operator: "gte",
            value: 50000,
            parameterKey: "stripe.refund_review_threshold_cents",
            effect: "ESCALATE",
          },
        ],
        controlMappings: [
          { framework: "SOC2", controlId: "CC6.1", rationale: "Reviews high-value financial transactions." },
        ],
        // Unmodeled fields that must survive the round-trip.
        priority: 7,
        preservedFields: { agtNativeKey: "keep-me" },
      },
    ]);

    const result = parseRulesPayload(payload);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    const [rule] = result.rules;

    expect(rule.parameterConstraints).toEqual([
      {
        field: "amount_cents",
        operator: "gte",
        value: 50000,
        parameterKey: "stripe.refund_review_threshold_cents",
        effect: "ESCALATE",
      },
    ]);
    expect(rule.controlMappings).toEqual([
      { framework: "SOC2", controlId: "CC6.1", rationale: "Reviews high-value financial transactions." },
    ]);
    // Unmodeled fields pass through untouched.
    expect(rule.priority).toBe(7);
    expect(rule.preservedFields).toEqual({ agtNativeKey: "keep-me" });
  });

  it("rejects constraints with an unknown operator by dropping them, keeping valid rules", () => {
    const payload = JSON.stringify([
      {
        stableRuleId: "rule-a",
        title: "Rule A",
        effect: "WARN",
        domains: [],
        connectors: [],
        actions: [],
        immutable: false,
        parameterConstraints: [
          { field: "x", operator: "bogus", value: 1 },
          { field: "y", operator: "lt", value: 10 },
        ],
      },
    ]);

    const result = parseRulesPayload(payload);
    expect("rules" in result).toBe(true);
    if (!("rules" in result)) return;
    expect(result.rules[0].parameterConstraints).toEqual([{ field: "y", operator: "lt", value: 10 }]);
  });
});

// Guards the immutability check: an inherited-immutable rule must not be
// mutable through UNMODELED fields (priority, conditions, AGT-native, ...) that
// the modeled isSameRule comparison ignores — e.g. via the raw-JSON escape hatch.
describe("unmodeledRuleFieldsMatch (immutability guard)", () => {
  const baseline = {
    stableRuleId: "org.baseline.lock",
    title: "Locked",
    effect: "DENY",
    immutable: true,
    domains: ["audit"],
    priority: 5,
    conditions: [{ field: "region", op: "eq", value: "eu" }],
    originalRule: { stable_rule_id: "org.baseline.lock", agt_native: true },
    sourcePath: "packs/org-baseline.json",
  };

  it("passes when unmodeled fields are identical (order/undefined-insensitive)", () => {
    const candidate = {
      // Different key order, an extra present-but-undefined modeled field, same unmodeled content.
      sourcePath: "packs/org-baseline.json",
      originalRule: { agt_native: true, stable_rule_id: "org.baseline.lock" },
      conditions: [{ field: "region", op: "eq", value: "eu" }],
      priority: 5,
      title: "Locked",
      effect: "DENY",
      immutable: true,
      domains: ["audit"],
      semanticChecks: undefined,
    };
    expect(unmodeledRuleFieldsMatch(baseline, candidate)).toBe(true);
  });

  it("rejects a changed unmodeled scalar (priority)", () => {
    expect(unmodeledRuleFieldsMatch(baseline, { ...baseline, priority: 999 })).toBe(false);
  });

  it("rejects a tampered AGT-native / nested field", () => {
    expect(
      unmodeledRuleFieldsMatch(baseline, { ...baseline, originalRule: { stable_rule_id: "org.baseline.lock", agt_native: false } })
    ).toBe(false);
  });

  it("rejects a mutated deterministic condition", () => {
    expect(
      unmodeledRuleFieldsMatch(baseline, { ...baseline, conditions: [{ field: "region", op: "eq", value: "us" }] })
    ).toBe(false);
  });

  it("rejects an injected arbitrary unmodeled field", () => {
    expect(unmodeledRuleFieldsMatch(baseline, { ...baseline, backdoor: true })).toBe(false);
  });

  it("ignores differences in modeled fields (those are covered by isSameRule)", () => {
    // Only unmodeled fields matter here; a modeled-field change must not affect this check.
    expect(unmodeledRuleFieldsMatch(baseline, { ...baseline, effect: "ALLOW", title: "Changed" })).toBe(true);
  });
});
