import { describe, expect, it } from "vitest";
import { composePolicyLayers } from "../src/schema";
import type { CompositionLayer, PolicyRuleSummary } from "../src/types";

function rule(overrides: Partial<PolicyRuleSummary> = {}): PolicyRuleSummary {
  return {
    stableRuleId: "shared",
    title: "Rule",
    effect: "ALLOW",
    domains: [],
    connectors: [],
    actions: [],
    immutable: false,
    ...overrides,
  } as PolicyRuleSummary;
}

function layer(scope: string, rules: PolicyRuleSummary[]): CompositionLayer {
  return {
    scope,
    branchId: `branch-${scope}`,
    revisionId: `rev-${scope}`,
    rules,
  } as CompositionLayer;
}

const compose = (layers: CompositionLayer[]) =>
  composePolicyLayers({
    id: "preview",
    branchId: "branch",
    revisionId: "revision",
    layers,
    composedArtifactHash: "sha256:test",
    composedAt: "1970-01-01T00:00:00.000Z",
  });

describe("composePolicyLayers", () => {
  it("lets a more specific layer override a mutable rule", () => {
    const result = compose([
      layer("ORGANIZATION", [rule({ effect: "ALLOW" })]),
      layer("WORKSPACE", [rule({ effect: "DENY" })]),
    ]);
    expect(result.effectiveRules.map((r) => r.effect)).toEqual(["DENY"]);
    expect(result.conflictNotes).toEqual([
      'Override: WORKSPACE layer has updated rule "shared" from ORGANIZATION.',
    ]);
  });

  it("protects an immutable rule from a lower layer", () => {
    const result = compose([
      layer("ORGANIZATION", [rule({ effect: "DENY", immutable: true })]),
      layer("WORKSPACE", [rule({ effect: "ALLOW" })]),
    ]);
    expect(result.effectiveRules.map((r) => r.effect)).toEqual(["DENY"]);
    expect(result.conflictNotes[0]).toContain("is immutable in ORGANIZATION");
  });

  it("accumulates disjoint rules in layer order", () => {
    const result = compose([
      layer("ORGANIZATION", [rule({ stableRuleId: "a" })]),
      layer("WORKSPACE", [rule({ stableRuleId: "b" })]),
    ]);
    expect(result.effectiveRules.map((r) => r.stableRuleId)).toEqual(["a", "b"]);
    expect(result.conflictNotes).toEqual([]);
  });

  // Composition runs in the kernel, which models a subset of a rule's fields.
  // It returns winning positions rather than rules precisely so that everything
  // it does not model survives; a regression here silently drops authored data
  // out of every published bundle.
  it("returns the host's own rule objects, not a kernel projection", () => {
    const winner = rule({
      effect: "DENY",
      controlMappings: [{ framework: "SOC2", control: "CC6.1" }],
      unmodeledByKernel: { authoredBy: "reviewer-1" },
    } as never);
    const result = compose([
      layer("ORGANIZATION", [rule({ effect: "ALLOW" })]),
      layer("WORKSPACE", [winner]),
    ]);
    expect(result.effectiveRules).toHaveLength(1);
    expect(result.effectiveRules[0]).toBe(winner);
    expect(result.effectiveRules[0]).toMatchObject({
      controlMappings: [{ framework: "SOC2", control: "CC6.1" }],
      unmodeledByKernel: { authoredBy: "reviewer-1" },
    });
  });

  it("composes an empty layer set without conflict", () => {
    const result = compose([]);
    expect(result.effectiveRules).toEqual([]);
    expect(result.conflictNotes).toEqual([]);
  });
});
