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
