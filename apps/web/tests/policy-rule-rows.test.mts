import { describe, expect, it } from "vitest";
import { POLICY_RULE_COLUMNS, toPolicyRuleRows } from "../lib/repositories/policy/rule-rows.js";

const base = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "ws-1",
  branchId: "br-1",
  revisionId: "rev-1",
};

describe("toPolicyRuleRows", () => {
  it("persists the matcher fields the runtime evaluator needs", () => {
    const [row] = toPolicyRuleRows({
      ...base,
      rules: [
        {
          stableRuleId: "stripe.refund.high_value",
          title: "Escalate high-value refunds",
          effect: "ESCALATE",
          domains: ["refunds"],
          connectors: ["stripe"],
          actions: ["refund.create"],
          immutable: true,
          semanticChecks: [{ id: "s1", prompt: "credential exposure", effect: "DENY" }],
          parameterConstraints: [{ field: "amount", operator: "gt", value: 1000 }],
        },
      ],
    });

    // The regression this guards: these two were dropped on write, so the
    // gateway evaluated the rule as a bare connector/action match.
    expect(row.semantic_checks).toBe(
      JSON.stringify([{ id: "s1", prompt: "credential exposure", effect: "DENY" }]),
    );
    expect(row.parameter_constraints).toBe(
      JSON.stringify([{ field: "amount", operator: "gt", value: 1000 }]),
    );
    expect(row.immutable).toBe(true);
    expect(row.domains).toEqual(["refunds"]);
  });

  it("stores absent and empty matcher lists identically as NULL", () => {
    const [absent] = toPolicyRuleRows({
      ...base,
      rules: [{ stableRuleId: "r", title: "t", effect: "ALLOW" }],
    });
    const [empty] = toPolicyRuleRows({
      ...base,
      rules: [
        {
          stableRuleId: "r",
          title: "t",
          effect: "ALLOW",
          semanticChecks: [],
          parameterConstraints: [],
        },
      ],
    });
    expect(absent.semantic_checks).toBeNull();
    expect(absent.parameter_constraints).toBeNull();
    expect(empty.semantic_checks).toBeNull();
    expect(empty.parameter_constraints).toBeNull();
  });

  it("falls back to the revision source path only when the rule lacks one", () => {
    const rows = toPolicyRuleRows({
      ...base,
      sourcePath: "revision.yaml",
      rules: [
        { stableRuleId: "a", title: "t", effect: "ALLOW", sourcePath: "rule.yaml" },
        { stableRuleId: "b", title: "t", effect: "ALLOW" },
      ],
    });
    expect(rows[0].source_path).toBe("rule.yaml");
    expect(rows[1].source_path).toBe("revision.yaml");
  });

  it("defaults missing array and flag fields rather than emitting undefined", () => {
    const [row] = toPolicyRuleRows({
      ...base,
      rules: [{ stableRuleId: "r", title: "t", effect: "ALLOW" }],
    });
    expect(row.domains).toEqual([]);
    expect(row.connectors).toEqual([]);
    expect(row.actions).toEqual([]);
    expect(row.immutable).toBe(false);
    expect(row.source_path).toBeNull();
  });

  it("copies readonly inputs into mutable arrays", () => {
    const rules = [
      {
        stableRuleId: "r",
        title: "t",
        effect: "ALLOW",
        domains: ["ops"],
        connectors: ["github"],
        actions: ["push"],
      },
    ] as const;
    const [row] = toPolicyRuleRows({ ...base, rules });
    row.domains.push("mutated");
    expect(rules[0].domains).toEqual(["ops"]);
  });

  it("keeps the column list aligned with the row shape", () => {
    const [row] = toPolicyRuleRows({
      ...base,
      rules: [{ stableRuleId: "r", title: "t", effect: "ALLOW" }],
    });
    // A column added to one and not the other would silently write NULL or
    // throw at insert time; assert they stay in lockstep.
    expect([...POLICY_RULE_COLUMNS].sort()).toEqual(Object.keys(row).sort());
  });
});
