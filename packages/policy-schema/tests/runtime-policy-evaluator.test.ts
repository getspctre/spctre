import { describe, expect, it } from "vitest";
import { evaluateRuntimePolicyDecision } from "../src/index";
import type { PolicyRuleSummary } from "../src/index";

const baseRule: PolicyRuleSummary = {
  stableRuleId: "runtime.integration.typed-fields",
  title: "Typed runtime integration fields",
  effect: "DENY",
  sourceFormat: "SPCTRE_MANAGED",
  domains: [],
  connectors: ["runtime"],
  actions: ["tool.call"],
  immutable: false,
};

describe("evaluateRuntimePolicyDecision", () => {
  it("matches typed runtime, deployment, provenance, prompt, and company evidence fields", () => {
    const result = evaluateRuntimePolicyDecision({
      connector: "runtime",
      action: "tool.call",
      runtimeTarget: {
        stack: "PAPERCLIP",
        sandboxName: "nemo-prod",
        inferenceProvider: "nim-local",
      },
      orchestratorRef: {
        platform: "paperclip",
        companyId: "company-123",
        issueId: "issue-456",
        goalId: "goal-789",
      },
      skillContext: {
        activeSkills: ["risk-review"],
        promptSurface: "before_prompt_build",
      },
      triggerKind: "mobile_dispatch",
      layer: "sandbox",
      pluginSource: "corporate_private",
      trustLevel: "restricted",
      catalogProvider: "paperclip",
      rules: [
        {
          ...baseRule,
          runtimeStacks: ["PAPERCLIP"],
          sandboxNames: ["nemo-prod"],
          inferenceProviders: ["nim-local"],
          orchestratorPlatforms: ["paperclip"],
          companyIds: ["company-123"],
          issueIds: ["issue-456"],
          goalIds: ["goal-789"],
          skillIds: ["risk-review"],
          promptSurfaces: ["before_prompt_build"],
          triggerKind: "mobile_dispatch",
          layer: "sandbox",
          pluginSources: ["corporate_private"],
          trustLevels: ["restricted"],
          catalogProviders: ["paperclip"],
        },
      ],
      evaluatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(result.status).toBe("DENY");
    expect(result.matchedRefs).toEqual(["runtime.integration.typed-fields"]);
  });

  it("does not match company-scoped rules against another Paperclip company", () => {
    const result = evaluateRuntimePolicyDecision({
      connector: "runtime",
      action: "tool.call",
      orchestratorRef: {
        platform: "paperclip",
        companyId: "company-other",
      },
      rules: [
        {
          ...baseRule,
          companyIds: ["company-123"],
        },
      ],
    });

    expect(result.status).toBe("ALLOW");
    expect(result.matchedRefs).toEqual([]);
  });
});
