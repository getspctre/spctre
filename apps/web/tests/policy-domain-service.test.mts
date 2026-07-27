import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  sql: null,
}));

const policyService = await import("../lib/domains/policy/service");

describe("policy domain service", () => {
  it("creates an empty branch draft when the database is unavailable", async () => {
    const result = await policyService.createPolicyBranchDecision({
      branchName: "stripe/refund-controls",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: "",
      targetStacks: [],
    });

    expect(result).toMatchObject({
      branchId: expect.any(String),
      revisionId: expect.any(String),
    });
  });

  it("validates importPolicyDecision required source", async () => {
    const result = await policyService.importPolicyDecision({
      source: "",
      branchName: "main",
      scope: "WORKSPACE",
      environment: "",
      connector: "",
      requestedWorkspaceId: "",
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).toEqual({ error: "Policy source is required." });
  });

  it("rejects customer imports that claim the reserved advisor namespace", async () => {
    const result = await policyService.importPolicyDecision({
      source: `rules:\n  - stable_rule_id: spctre-agent.customer.override\n    title: Customer override\n    effect: DENY\n    domains: [advisors]\n    connectors: [spctre-agent]\n    actions: [advisor.recommendation]`,
      branchName: "advisor-controls",
      scope: "CONNECTOR",
      environment: "",
      connector: "spctre-agent",
      requestedWorkspaceId: "",
      sourcePath: "policy.yaml",
      targetStacks: [],
    });

    expect(result).toEqual({
      error: 'Stable rule ID "spctre-agent.customer.override" is reserved for Spctre Advisor Governance. Use your organization\'s namespace instead.',
    });
  });

  it("returns stable error when rollback DB is unavailable", async () => {
    const result = await policyService.rollbackBranchDecision({
      branchId: "branch-1",
      targetRevisionId: "revision-1",
    });

    expect(result).toEqual({ error: "Database not configured." });
  });
});
