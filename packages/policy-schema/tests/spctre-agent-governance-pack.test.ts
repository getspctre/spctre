import { describe, expect, it } from "vitest";
import { POLICY_PACKS } from "../src/index";

describe("Spctre Simulation Guidance Governance Pack", () => {
  const pack = POLICY_PACKS.find((candidate) => candidate.connector === "spctre-agent");

  it("publishes a hand-authored simulation guidance governance pack", () => {
    expect(pack).toBeDefined();
    expect(pack?.id).toBe("spctre-agent-governance-v1");
    expect(pack?.metadata.generated).toBe(false);
    expect(pack?.name).toBe("Spctre Simulation Guidance Governance Pack");
    expect(pack?.metadata.category).toBe("Simulation guidance governance");
    expect(pack?.metadata.minimumApprovals).toBe(2);
  });

  it("requires attribution and human decision gates for simulation guidance", () => {
    const ruleText = pack?.rules.map((rule) => `${rule.stableRuleId} ${rule.title}`).join("\n") ?? "";

    expect(ruleText).toMatch(/unnamed_principal|named, versioned system principal/);
    expect(ruleText).toMatch(/require_agent_triage_log|SIMULATION_GUIDANCE/);
    expect(ruleText).toMatch(/require_operations_log|simulation guidance/);
    expect(ruleText).toMatch(/require_human_rationale|human reviewer rationale/);
  });

  it("denies system-initiated resolution, approval, publish, and policy mutation", () => {
    const denyActions = new Set(
      pack?.rules
        .filter((rule) => rule.effect === "DENY")
        .flatMap((rule) => rule.actions) ?? []
    );

    expect(denyActions).toContain("escalation.resolve");
    expect(denyActions).toContain("approval.approve");
    expect(denyActions).toContain("policy.publish");
    expect(denyActions).toContain("rule.modify");
    expect(denyActions).toContain("triage.accept_without_rationale");
  });

  it("keeps all rules scoped to the guidance connector", () => {
    for (const rule of pack?.rules ?? []) {
      expect(rule.connectors, rule.stableRuleId).toEqual(["spctre-agent"]);
    }
  });
});
