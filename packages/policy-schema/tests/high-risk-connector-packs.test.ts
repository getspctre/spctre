import { describe, expect, it } from "vitest";
import { POLICY_PACKS, validatePolicyControlMappings } from "../src/index";

const highRiskConnectors = [
  "stripe",
  "stripe-billing",
  "stripe-connect",
  "stripe-issuing",
  "postgresql",
  "mongodb",
  "snowflake",
  "aws-dynamodb",
  "github",
  "github-actions",
  "github-enterprise-admin",
  "deployment",
  "kubernetes",
  "vercel",
  "argo-cd",
  "zendesk",
  "zendesk-support-admin",
] as const;

describe("hand-authored high-risk connector packs", () => {
  it("replaces the generated template for every listed connector", () => {
    for (const connector of highRiskConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);
      expect(pack, connector).toBeDefined();
      expect(pack?.metadata.generated, connector).toBe(false);
      expect(pack?.riskLevel, connector).toBe("HIGH");
    }
  });

  it("keeps rules scoped to their own connector", () => {
    for (const connector of highRiskConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);
      for (const rule of pack?.rules ?? []) {
        expect(rule.connectors, rule.stableRuleId).toEqual([connector]);
      }
    }
  });

  it("has no duplicate or malformed control mappings", () => {
    for (const connector of highRiskConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);
      const issues = validatePolicyControlMappings(
        (pack?.rules ?? []).map((rule) => ({ ...rule, sourceFormat: "SPCTRE_MANAGED" })),
      );
      expect(issues, connector).toEqual([]);
    }
  });

  it("registers a parameter definition for every rule-level parameterKey referenced", () => {
    for (const connector of highRiskConnectors) {
      const pack = POLICY_PACKS.find((candidate) => candidate.connector === connector);
      const definedKeys = new Set((pack?.parameters ?? []).map((p) => p.key));
      for (const rule of pack?.rules ?? []) {
        for (const constraint of rule.parameterConstraints ?? []) {
          if (constraint.parameterKey) {
            expect(
              definedKeys.has(constraint.parameterKey),
              `${connector}: ${constraint.parameterKey}`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
