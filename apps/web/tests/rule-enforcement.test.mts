import { describe, expect, it } from "vitest";
import { assessRuleEnforcement, enforcementPillClass } from "../lib/policy/rule-enforcement";

describe("assessRuleEnforcement", () => {
  it("classifies a deterministic DENY as a pre-action block", () => {
    const a = assessRuleEnforcement({ effect: "DENY" });
    expect(a.disposition).toBe("DETERMINISTIC");
    expect(a.deterministic).toBe(true);
    expect(a.label).toBe("Pre-action block");
  });

  it("classifies a deterministic ESCALATE as a pre-action escalate", () => {
    const a = assessRuleEnforcement({ effect: "ESCALATE" });
    expect(a.disposition).toBe("DETERMINISTIC");
    expect(a.label).toBe("Pre-action escalate");
  });

  it("downgrades a blocking rule with semantic checks to SEMANTIC (needs a runtime evaluator)", () => {
    const a = assessRuleEnforcement({
      effect: "DENY",
      semanticChecks: [{ id: "s1", prompt: "check for destructive intent" }],
    });
    expect(a.disposition).toBe("SEMANTIC");
    expect(a.deterministic).toBe(false);
  });

  it("classifies WARN as advisory regardless of checks", () => {
    expect(assessRuleEnforcement({ effect: "WARN" }).disposition).toBe("ADVISORY");
  });

  it("classifies ALLOW as allow", () => {
    expect(assessRuleEnforcement({ effect: "ALLOW" }).disposition).toBe("ALLOW");
  });

  it("maps dispositions to pill classes", () => {
    expect(enforcementPillClass("DETERMINISTIC")).toBe("pill pillEnforced");
    expect(enforcementPillClass("SEMANTIC")).toBe("pill pillWarn");
    expect(enforcementPillClass("ADVISORY")).toBe("pill pillNeutral");
    expect(enforcementPillClass("ALLOW")).toBe("pill pillNeutral");
    expect(enforcementPillClass("OBSERVE")).toBe("pill pillBlock");
  });

  describe("with declared runtime coverage", () => {
    it("downgrades a blocking rule to OBSERVE when no adapter covers its connector", () => {
      const a = assessRuleEnforcement(
        { effect: "DENY", connectors: ["stripe"] },
        { adapterCount: 1, coveredConnectors: ["github"] }
      );
      expect(a.disposition).toBe("OBSERVE");
      expect(a.label).toBe("Observe-only");
    });

    it("keeps DETERMINISTIC when an adapter covers the connector", () => {
      const a = assessRuleEnforcement(
        { effect: "DENY", connectors: ["stripe"] },
        { adapterCount: 1, coveredConnectors: ["stripe"] }
      );
      expect(a.disposition).toBe("DETERMINISTIC");
    });

    it("stays rule-intrinsic when no adapters are declared (coverage unknown)", () => {
      const a = assessRuleEnforcement(
        { effect: "DENY", connectors: ["stripe"] },
        { adapterCount: 0, coveredConnectors: [] }
      );
      expect(a.disposition).toBe("DETERMINISTIC");
    });

    it("does not downgrade non-blocking effects", () => {
      expect(
        assessRuleEnforcement({ effect: "WARN", connectors: ["stripe"] }, { adapterCount: 1, coveredConnectors: ["github"] }).disposition
      ).toBe("ADVISORY");
    });
  });
});
