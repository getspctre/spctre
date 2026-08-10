import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PolicyKernelAbiError, createPortablePolicyKernel } from "../src/wasm";
import { evaluateRuntimePolicyDecision } from "../src/schema";
import type { PolicyRuleSummary } from "../src/types";

const kernel = await createPortablePolicyKernel(
  readFileSync(new URL("../native/spctre_policy_core.wasm", import.meta.url)),
);

function rule(overrides: Partial<PolicyRuleSummary> = {}): PolicyRuleSummary {
  return {
    stableRuleId: "refund.block",
    title: "Block refunds",
    effect: "DENY",
    domains: [],
    connectors: ["stripe"],
    actions: ["refund"],
    immutable: false,
    ...overrides,
  } as PolicyRuleSummary;
}

describe("portable policy kernel", () => {
  it("instantiates with no imports and no generated glue", async () => {
    await expect(
      createPortablePolicyKernel(
        readFileSync(new URL("../native/spctre_policy_core.wasm", import.meta.url)),
      ),
    ).resolves.toBeDefined();
  });

  // The point of the portable target: the same decision, from the same kernel,
  // on a host that cannot load the native addon.
  it("decides identically to the native addon", () => {
    const input = {
      connector: "stripe",
      action: "refund",
      domains: [],
      rules: [rule()],
      toolIntent: "",
      planSummary: "",
      toolParameters: {},
      policyArtifactHash: "sha256:fixture",
    };
    const portable = kernel.evaluatePolicyDecision(input);
    const native = evaluateRuntimePolicyDecision({
      connector: "stripe",
      action: "refund",
      rules: [rule()],
      policyArtifactHash: "sha256:fixture",
    });

    expect(portable.status).toBe(native.status);
    expect(portable.matchedRefs).toEqual(native.matchedRefs);
    expect(portable.trace).toEqual(native.trace);
    expect(portable.evaluatorVersion).toBe(native.evaluatorVersion);
    expect(portable.policyArtifactHash).toBe("sha256:fixture");
  });

  it("composes layers with the same precedence as the other transports", () => {
    const selection = kernel.composePolicyLayers([
      { scope: "ORGANIZATION", rules: [rule({ immutable: true })] },
      { scope: "WORKSPACE", rules: [rule({ effect: "ALLOW" })] },
    ]);
    expect(selection.effective).toHaveLength(1);
    expect(selection.effective[0].layerIndex).toBe(0);
    expect(selection.conflictNotes[0]).toContain("immutable");
  });

  it("validates bundles through the same kernel checks", () => {
    const validation = kernel.validatePolicyBundle({
      rules: [rule({ actions: ["refund.*.reverse"] })],
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues[0].code).toBe("unsupported_wildcard");
  });

  // A portable host must fail closed on a nonzero status like any other caller.
  it("throws rather than returning a verdict when the ABI rejects a request", () => {
    expect(() =>
      kernel.evaluatePolicyDecision({ rules: "not a list" } as unknown as Record<string, unknown>),
    ).toThrow(PolicyKernelAbiError);
  });

  // The portable path is a delivery target, not a second evaluator: it must
  // reproduce the reviewed contract corpus exactly, with the same deterministic
  // metadata the other transports return.
  it("satisfies the published evaluator contract over the whole corpus", () => {
    const corpus = JSON.parse(
      readFileSync(new URL("../../../conformance/policy-rules.json", import.meta.url), "utf8"),
    ) as {
      contract: { evaluatorVersion: string };
      cases: {
        description: string;
        rules: PolicyRuleSummary[];
        connector: string;
        action: string;
        domains: string[];
        toolIntent: string;
        planSummary: string;
        toolParameters: Record<string, unknown>;
        expected: { status: string; matchedRefs: string[] };
      }[];
    };
    expect(corpus.cases.length).toBeGreaterThan(0);

    for (const testCase of corpus.cases) {
      const result = kernel.evaluatePolicyDecision({
        connector: testCase.connector,
        action: testCase.action,
        domains: testCase.domains,
        rules: testCase.rules,
        toolIntent: testCase.toolIntent,
        planSummary: testCase.planSummary,
        toolParameters: testCase.toolParameters,
        policyArtifactHash: "sha256:corpus",
      });
      expect(result.status, testCase.description).toBe(testCase.expected.status);
      expect(result.matchedRefs, testCase.description).toEqual(testCase.expected.matchedRefs);
      expect(result.evaluatorVersion, testCase.description).toBe(corpus.contract.evaluatorVersion);
      expect(result.policyArtifactHash, testCase.description).toBe("sha256:corpus");
      expect(result.trace, testCase.description).toHaveLength(testCase.rules.length);
    }
  });

  it("composes the corpus composition cases identically", () => {
    const corpus = JSON.parse(
      readFileSync(new URL("../../../conformance/policy-rules.json", import.meta.url), "utf8"),
    ) as {
      compositionCases: {
        description: string;
        layers: { scope: string; rules: PolicyRuleSummary[] }[];
        expectedRuleIds: string[];
        expectedConflictNotes: string[];
      }[];
    };

    for (const testCase of corpus.compositionCases) {
      const selection = kernel.composePolicyLayers(testCase.layers);
      expect(
        selection.effective.map((slot) => slot.stableRuleId),
        testCase.description,
      ).toEqual(testCase.expectedRuleIds);
      expect(selection.conflictNotes, testCase.description).toEqual(testCase.expectedConflictNotes);
    }
  });

  it("survives repeated calls without corrupting linear memory", () => {
    for (let index = 0; index < 200; index += 1) {
      const result = kernel.evaluatePolicyDecision({
        connector: "stripe",
        action: "refund",
        rules: [rule({ stableRuleId: `rule-${index}` })],
        toolParameters: { note: "x".repeat(index) },
      });
      expect(result.status).toBe("DENY");
    }
  });
});
