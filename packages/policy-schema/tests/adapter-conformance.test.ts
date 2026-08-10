// Adapter conformance for the N-API delivery path.
//
// The reviewed corpus is the contract; this asserts that the transport the
// control plane uses binds to the one kernel and preserves what it decided.
// The same corpus is run through the cgo adapter (apps/worker) and the portable
// WASM adapter (tests/wasm.test.ts), so all three delivery paths are held to one
// artifact rather than to each other.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composePolicyLayers, evaluateRuntimePolicyDecision } from "../src/schema";
import type { PolicyRuleSummary } from "../src/types";

type Corpus = {
  contract: { evaluatorVersion: string; requestSchemaVersion: string; resultSchemaVersion: string };
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
  compositionCases: {
    description: string;
    layers: { scope: string; rules: PolicyRuleSummary[] }[];
    expectedRuleIds: string[];
    expectedEffects: string[];
    expectedConflictNotes: string[];
  }[];
};

const corpus = JSON.parse(
  readFileSync(new URL("../../../conformance/policy-rules.json", import.meta.url), "utf8"),
) as Corpus;

describe("N-API adapter conformance", () => {
  it("carries a corpus the contract version recognises", () => {
    expect(corpus.contract.evaluatorVersion).toBe("1.0");
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  it.each(corpus.cases.map((testCase) => [testCase.description, testCase] as const))(
    "decides %s as the contract specifies",
    (_description, testCase) => {
      const result = evaluateRuntimePolicyDecision({
        connector: testCase.connector,
        action: testCase.action,
        domains: testCase.domains,
        rules: testCase.rules,
        toolIntent: testCase.toolIntent,
        planSummary: testCase.planSummary,
        toolParameters: testCase.toolParameters,
        policyArtifactHash: "sha256:corpus",
      });

      expect(result.status).toBe(testCase.expected.status);
      expect(result.matchedRefs).toEqual(testCase.expected.matchedRefs);

      // Provenance must survive the transport, not just the verdict. This is
      // exactly what the Go adapter used to drop.
      expect(result.evaluatorVersion).toBe(corpus.contract.evaluatorVersion);
      expect(result.requestSchemaVersion).toBe(corpus.contract.requestSchemaVersion);
      expect(result.resultSchemaVersion).toBe(corpus.contract.resultSchemaVersion);
      expect(result.policyArtifactHash).toBe("sha256:corpus");
      expect(result.trace).toHaveLength(testCase.rules.length);
      expect(result.ruleCount).toBe(testCase.rules.length);
    },
  );

  it.each(corpus.compositionCases.map((testCase) => [testCase.description, testCase] as const))(
    "composes %s as the contract specifies",
    (_description, testCase) => {
      const composition = composePolicyLayers({
        id: "conformance",
        branchId: "branch",
        revisionId: "revision",
        layers: testCase.layers as never,
        composedArtifactHash: "sha256:corpus",
        composedAt: "1970-01-01T00:00:00.000Z",
      });

      expect(composition.effectiveRules.map((rule) => rule.stableRuleId)).toEqual(
        testCase.expectedRuleIds,
      );
      expect(composition.effectiveRules.map((rule) => rule.effect)).toEqual(
        testCase.expectedEffects,
      );
      expect(composition.conflictNotes).toEqual(testCase.expectedConflictNotes);
    },
  );
});
