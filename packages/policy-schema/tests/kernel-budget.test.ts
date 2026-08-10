import { describe, expect, it } from "vitest";
import {
  POLICY_KERNEL_RUNTIME_HEADROOM_BYTES,
  describePolicyRequestBudget,
  measurePolicyRequestBudget,
  policyKernelLimits,
} from "../src/kernel-budget";
import type { PolicyRuleSummary } from "../src/types";

function rule(overrides: Partial<PolicyRuleSummary> = {}): PolicyRuleSummary {
  return {
    stableRuleId: "rule-1",
    title: "Rule",
    effect: "DENY",
    domains: [],
    connectors: [],
    actions: [],
    immutable: false,
    ...overrides,
  } as PolicyRuleSummary;
}

// The limit must come from the kernel. A copy in TypeScript drifts silently the
// moment the ABI changes its bounds.
describe("policyKernelLimits", () => {
  it("reports the kernel's own ABI bounds", () => {
    const limits = policyKernelLimits();
    expect(limits.maxRequestBytes).toBe(1_048_576);
    expect(limits.maxResponseBytes).toBe(1_048_576);
  });
});

describe("measurePolicyRequestBudget", () => {
  it("reserves runtime headroom below the ABI maximum", () => {
    const budget = measurePolicyRequestBudget([{ scope: "WORKSPACE", rules: [rule()] }]);
    expect(budget.usableBytes).toBe(budget.maxRequestBytes - POLICY_KERNEL_RUNTIME_HEADROOM_BYTES);
    expect(budget.fits).toBe(true);
    expect(budget.utilization).toBeLessThan(0.01);
  });

  it("counts only the rule fields the request carries", () => {
    const lean = measurePolicyRequestBudget([{ scope: "WORKSPACE", rules: [rule()] }]);
    const withIgnoredField = measurePolicyRequestBudget([
      {
        scope: "WORKSPACE",
        // A field the kernel request does not include must not inflate the
        // measurement, or the guard would refuse policies that actually fit.
        rules: [rule({ controlMappings: [{ framework: "SOC2", control: "CC6.1" }] } as never)],
      },
    ]);
    expect(withIgnoredField.policyBytes).toBe(lean.policyBytes);
  });

  it("does not fit once policy exceeds the usable budget", () => {
    const wide = Array.from({ length: 4000 }, (_, index) =>
      rule({
        stableRuleId: `rule-${index}`,
        title: `A rule with a title long enough to take real space ${index}`,
        actions: ["connector.action.one", "connector.action.two"],
      }),
    );
    const budget = measurePolicyRequestBudget([{ scope: "WORKSPACE", rules: wide }]);
    expect(budget.fits).toBe(false);
    expect(budget.utilization).toBeGreaterThan(1);
    expect(describePolicyRequestBudget(budget)).toMatch(/usable evaluation budget/);
  });
});
