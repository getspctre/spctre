import { describe, expect, it } from "vitest";
import { parseAgentBlueprintDefinition } from "../lib/domains/agent-blueprints/service";
import { buildAgentBlueprintRuntimeArtifact, diffAgentBlueprintRevisions } from "@spctre/policy-schema";

const validDefinition = {
  purpose: "Resolve customer refund requests within the approved support workflow.",
  allowedTaskClasses: ["refund-review"],
  tools: ["stripe.refunds.create"],
  connectors: ["stripe"],
  services: ["support-api"],
  environments: ["production"],
  runtimeTargets: [{ stack: "OPENAI_AGENTS", environment: "production" }],
  budgets: { maxTokensPerTurn: 4000, maxCostUsdPerSession: 2 },
  approvalPath: ["Support", "Finance"],
  policyBranchId: "branch-1",
  policyRevisionId: "revision-1",
};

describe("agent blueprint definition validation", () => {
  it("accepts a bounded declarative operating envelope", () => {
    expect(parseAgentBlueprintDefinition(validDefinition)).toEqual({ definition: validDefinition });
  });

  it("rejects incomplete targets and negative budgets", () => {
    expect(parseAgentBlueprintDefinition({ ...validDefinition, runtimeTargets: ["OPENAI_AGENTS"] }).error)
      .toContain("include a stack string");
    expect(parseAgentBlueprintDefinition({ ...validDefinition, budgets: { maxCostUsdPerSession: -1 } }).error)
      .toContain("non-negative number");
  });

  it("preserves an optional policy revision link for runtime-provenance matching", () => {
    const parsed = parseAgentBlueprintDefinition(validDefinition);
    expect(parsed.definition?.policyRevisionId).toBe("revision-1");
  });

  it("compiles a published revision into a portable runtime artifact", () => {
    const artifact = buildAgentBlueprintRuntimeArtifact({
      name: "Refund support agent",
      policyArtifactHash: "sha256:policy-artifact",
      generatedAt: "2026-07-16T00:00:00.000Z",
      revision: {
        id: "blueprint-revision-1",
        blueprintId: "blueprint-1",
        definition: validDefinition,
        definitionHash: "sha256:blueprint-definition",
        message: "Published support envelope",
        authorId: "author-1",
        status: "PUBLISHED",
        createdAt: "2026-07-16T00:00:00.000Z",
      },
    });
    expect(artifact).toMatchObject({
      kind: "spctre.agent-blueprint.v1",
      blueprint: { revisionId: "blueprint-revision-1", definitionHash: "sha256:blueprint-definition" },
      policy: { revisionId: "revision-1", artifactHash: "sha256:policy-artifact" },
    });
  });

  it("diffs only the declared operating-envelope fields that changed", () => {
    const base = {
      id: "revision-1", blueprintId: "blueprint-1", definition: validDefinition,
      definitionHash: "one", message: "Initial", authorId: "author", status: "PUBLISHED" as const, createdAt: "2026-07-16T00:00:00.000Z",
    };
    const compare = {
      ...base, id: "revision-2", parentRevisionId: base.id,
      definition: { ...validDefinition, tools: ["stripe.refunds.create", "stripe.refunds.cancel"], budgets: { maxTokensPerTurn: 6000 } },
    };
    expect(diffAgentBlueprintRevisions({ base, compare })).toMatchObject({
      changedFields: ["tools", "budgets"],
      summary: "2 declared operating-envelope fields changed.",
    });
  });
});
