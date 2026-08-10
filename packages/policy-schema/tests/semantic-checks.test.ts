import { describe, it, expect } from "vitest";
import {
  buildRuleControlMappingIndex,
  evaluateConnectorPayloadGuardrail,
  evaluateDecision,
  evaluateRuntimePolicyDrift,
  mapRuntimeProvenanceGaps,
  summarizeRuntimePolicyCoverage,
  diffPolicyRules,
} from "../src/index";
import type { PolicyRuleSummary } from "../src/index";

// Direct coverage of semantic classification lives with the kernel that
// implements it (conformance/semantic-intent.json). What is tested here is the
// behaviour reached through a policy decision.
describe("evaluateConnectorPayloadGuardrail", () => {
  const rules: PolicyRuleSummary[] = [
    {
      stableRuleId: "stripe.payload.deny_secret",
      title: "Deny secret payloads",
      effect: "DENY",
      sourceFormat: "SPCTRE_MANAGED",
      domains: [],
      connectors: ["stripe"],
      actions: ["charge"],
      immutable: false,
      semanticChecks: [{ id: "secret", prompt: "detect API keys" }],
    },
  ];

  it("returns policy provenance without retaining payload content", () => {
    const result = evaluateConnectorPayloadGuardrail({
      connector: "stripe",
      action: "charge",
      rules,
      toolParameters: { note: "api key sk_live_123" },
    });
    expect(result.status).toBe("DENY");
    expect(result.matchedPolicyRefs).toEqual(["stripe.payload.deny_secret"]);
    expect(result.payloadHash).toMatch(/^sha256:/);
  });

  it("denies oversized payload inspection", () => {
    const result = evaluateConnectorPayloadGuardrail({
      connector: "stripe",
      action: "charge",
      rules,
      toolParameters: { body: "x".repeat(33_000) },
    });
    expect(result.status).toBe("DENY");
    expect(result.matchedPolicyRefs).toEqual(["system.payload_size_limit"]);
  });
});

describe("rule control mappings", () => {
  it("indexes mappings and exposes them as review-relevant rule changes", () => {
    const base: PolicyRuleSummary = {
      stableRuleId: "rule",
      title: "Rule",
      effect: "DENY",
      sourceFormat: "SPCTRE_MANAGED",
      domains: [],
      connectors: [],
      actions: [],
      immutable: false,
    };
    const mapped = {
      ...base,
      controlMappings: [{ framework: "SOC2" as const, controlId: "CC6.1" }],
    };
    expect(buildRuleControlMappingIndex([mapped])).toMatchObject([
      { stableRuleId: "rule", controlId: "CC6.1" },
    ]);
    expect(
      diffPolicyRules({
        branchId: "b",
        baseRevisionId: "r1",
        compareRevisionId: "r2",
        before: [base],
        after: [mapped],
      }).rules[0].changedFields,
    ).toContain("controlMappings");
  });
});

describe("runtime policy drift", () => {
  it("distinguishes current, drifted, and provenance-gap heartbeats", () => {
    expect(
      evaluateRuntimePolicyDrift({
        agentId: "a",
        runtimeArtifactHash: "h",
        publishedArtifactHash: "h",
      }).status,
    ).toBe("CURRENT");
    expect(
      evaluateRuntimePolicyDrift({
        agentId: "a",
        runtimeArtifactHash: "old",
        publishedArtifactHash: "new",
      }).status,
    ).toBe("DRIFTED");
    expect(evaluateRuntimePolicyDrift({ agentId: "a", publishedArtifactHash: "h" }).status).toBe(
      "PROVENANCE_GAP",
    );
  });
});

describe("bounded runtime inventory", () => {
  it("only classifies declared runtime provenance", () => {
    expect(
      mapRuntimeProvenanceGaps({
        publishedArtifactHash: "h",
        runtimes: [
          { agentId: "a", runtimeTarget: "MCP", artifactHash: "h", policyContextPresent: true },
          { agentId: "b", runtimeTarget: "CLI", policyContextPresent: false },
        ],
      }).map((r) => r.coverage),
    ).toEqual(["GOVERNED", "PROVENANCE_GAP"]);
  });

  it("summarizes coverage and drift without discovering new assets", () => {
    expect(
      summarizeRuntimePolicyCoverage({
        publishedArtifactHash: "h",
        runtimes: [
          { agentId: "a", runtimeTarget: "MCP", artifactHash: "old", policyContextPresent: true },
        ],
      }),
    ).toMatchObject({ total: 1, governed: 0, provenanceGaps: 1, drifted: 1 });
  });
});

describe("evaluateDecision with semanticChecks", () => {
  const dummyRules: PolicyRuleSummary[] = [
    {
      stableRuleId: "rule-deterministic",
      title: "Deterministic Stripe deny",
      effect: "DENY",
      sourceFormat: "AGT_YAML",
      domains: [],
      connectors: ["stripe"],
      actions: ["charge"],
      immutable: false,
    },
    {
      stableRuleId: "rule-semantic-deny",
      title: "Semantic delete check",
      effect: "DENY",
      sourceFormat: "AGT_YAML",
      domains: [],
      connectors: ["github"],
      actions: ["repo.delete"],
      immutable: false,
      semanticChecks: [{ id: "check-delete", prompt: 'contains "delete repository"' }],
    },
    {
      stableRuleId: "rule-semantic-override",
      title: "Semantic credentials warning rule",
      effect: "DENY", // standard is deny
      sourceFormat: "AGT_YAML",
      domains: [],
      connectors: ["aws"],
      actions: ["s3.upload"],
      immutable: false,
      semanticChecks: [
        { id: "check-creds", prompt: "credentials", effect: "WARN" }, // override to warn
      ],
    },
  ];

  it("matches standard deterministic rule normally without semantic context", () => {
    const res = evaluateDecision({ connector: "stripe", action: "charge", rules: dummyRules });
    expect(res.status).toBe("DENY");
    expect(res.matchedRefs).toContain("rule-deterministic");
  });

  it("skips semantic rule when intent fields do not match semantic check", () => {
    const res = evaluateDecision({
      connector: "github",
      action: "repo.delete",
      toolIntent: "create a new repo branch",
      rules: dummyRules,
    });
    expect(res.status).toBe("ALLOW");
    expect(res.matchedRefs).not.toContain("rule-semantic-deny");
  });

  it("matches semantic rule when intent fields trigger semantic check", () => {
    const res = evaluateDecision({
      connector: "github",
      action: "repo.delete",
      toolIntent: "Delete repository immediately",
      rules: dummyRules,
    });
    expect(res.status).toBe("DENY");
    expect(res.matchedRefs).toContain("rule-semantic-deny");
    expect(res.reason).toMatch(/contains "delete repository"/);
  });

  it("applies semantic check override effect (e.g. WARN instead of rule effect DENY)", () => {
    const res = evaluateDecision({
      connector: "aws",
      action: "s3.upload",
      toolIntent: "save api key secret to s3 bucket",
      rules: dummyRules,
    });
    expect(res.status).toBe("WARN");
    expect(res.matchedRefs).toContain("rule-semantic-override");
    expect(res.reason).toMatch(/Warning from rule "rule-semantic-override"/);
  });
});

describe("diffPolicyRules with semanticChecks and conditions", () => {
  it("reports MODIFIED if semanticChecks field changes", () => {
    const beforeRule: PolicyRuleSummary = {
      stableRuleId: "rule-1",
      title: "My Rule",
      effect: "DENY",
      sourceFormat: "AGT_YAML",
      domains: [],
      connectors: [],
      actions: [],
      immutable: false,
      semanticChecks: [{ id: "check-1", prompt: "original prompt" }],
    };

    const afterRule: PolicyRuleSummary = {
      ...beforeRule,
      semanticChecks: [{ id: "check-1", prompt: "modified prompt" }],
    };

    const diff = diffPolicyRules({
      branchId: "branch-1",
      baseRevisionId: "rev-1",
      compareRevisionId: "rev-2",
      before: [beforeRule],
      after: [afterRule],
    });

    expect(diff.summary.modified).toBe(1);
    expect(diff.rules[0].status).toBe("MODIFIED");
    expect(diff.rules[0].changedFields).toContain("semanticChecks");
  });

  it("reports MODIFIED if conditions field changes", () => {
    const beforeRule: PolicyRuleSummary = {
      stableRuleId: "rule-1",
      title: "My Rule",
      effect: "DENY",
      sourceFormat: "AGT_YAML",
      domains: [],
      connectors: [],
      actions: [],
      immutable: false,
      conditions: [{ "request.path": { operator: "EQUALS", value: "/foo" } }],
    };

    const afterRule: PolicyRuleSummary = {
      ...beforeRule,
      conditions: [{ "request.path": { operator: "EQUALS", value: "/bar" } }],
    };

    const diff = diffPolicyRules({
      branchId: "branch-1",
      baseRevisionId: "rev-1",
      compareRevisionId: "rev-2",
      before: [beforeRule],
      after: [afterRule],
    });

    expect(diff.summary.modified).toBe(1);
    expect(diff.rules[0].status).toBe("MODIFIED");
    expect(diff.rules[0].changedFields).toContain("conditions");
  });
});
