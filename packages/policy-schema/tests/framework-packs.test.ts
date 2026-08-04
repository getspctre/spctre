import { describe, expect, it } from "vitest";
import { POLICY_PACKS } from "../src/index";

const frameworkConnectors = [
  "crewai",
  "langchain",
  "openai-agents",
  "autogen",
  "google-adk",
  "strands",
  "google-antigravity",
  "claude-agent-sdk",
] as const;

describe("framework governance packs", () => {
  it("publishes a hand-authored governance pack for every community framework", () => {
    for (const connector of frameworkConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);

      expect(pack, connector).toBeDefined();
      expect(pack?.metadata.generated, connector).toBe(false);
      expect(pack?.metadata.category, connector).toBe("Framework runtime governance");
      expect(pack?.rules.length, connector).toBeGreaterThanOrEqual(7);
    }
  });

  it("covers rate limits, data sensitivity, consequence tiers, and provenance for every framework", () => {
    for (const connector of frameworkConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);
      const searchableRules =
        pack?.rules.map((rule) => `${rule.stableRuleId} ${rule.title}`).join("\n") ?? "";

      expect(searchableRules, `${connector} rate limits`).toMatch(/rate.limit|rate-limit/i);
      expect(searchableRules, `${connector} data sensitivity`).toMatch(/sensitivity|unclassified/i);
      expect(searchableRules, `${connector} consequence tier`).toMatch(
        /consequence.tier|consequence tier/i,
      );
      expect(searchableRules, `${connector} provenance`).toMatch(/provenance/i);
    }
  });

  it("keeps framework rules scoped to their own connector", () => {
    for (const connector of frameworkConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);

      for (const rule of pack?.rules ?? []) {
        expect(rule.connectors, rule.stableRuleId).toEqual([connector]);
      }
    }
  });
});
