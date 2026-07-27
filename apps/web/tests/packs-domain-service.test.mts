import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { POLICY_PACKS, diffPolicyRules } from "@spctre/policy-schema";
import type { PolicyRuleSummary } from "@spctre/policy-schema";

const findConnectorBranchSpy = vi.fn();
const insertAuthorizationDenialEventSpy = vi.fn();
const listRulesForRevisionSpy = vi.fn();
const persistPackInstallBranchSpy = vi.fn();
const persistPackUpgradeRevisionSpy = vi.fn();
const resolveWorkspaceForActionSpy = vi.fn();
const isDatabaseConfiguredSpy = vi.fn().mockReturnValue(true);

const repositoryMocks = {
  findConnectorBranch: findConnectorBranchSpy,
  insertAuthorizationDenialEvent: insertAuthorizationDenialEventSpy,
  listRulesForRevision: listRulesForRevisionSpy,
  persistPackInstallBranch: persistPackInstallBranchSpy,
  persistPackUpgradeRevision: persistPackUpgradeRevisionSpy,
  resolveWorkspaceForAction: resolveWorkspaceForActionSpy,
  isDatabaseConfigured: isDatabaseConfiguredSpy,
};

vi.mock("@/lib/db", () => ({
  sql: {},
}));

vi.mock("@/lib/workspace/server-context", () => ({
  getWorkspaceContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    workspaceSlug: "default",
  })),
}));

vi.mock("@/lib/actors", () => ({
  getActiveActor: vi.fn(async () => ({
    actor: { id: "actor-1", name: "Admin" },
  })),
  requireActorAdminWorkspace: vi.fn(() => ({ allowed: true, reason: "" })),
}));

vi.mock("@/lib/repositories/packs", () => ({
  findConnectorBranch: findConnectorBranchSpy,
  listRulesForRevision: listRulesForRevisionSpy,
  listRulesForRevisions: vi.fn(async () => new Map()),
  persistPackInstallBranch: persistPackInstallBranchSpy,
  persistPackUpgradeRevision: persistPackUpgradeRevisionSpy,
}));
vi.mock("@/lib/repositories/workspace", () => ({
  insertAuthorizationDenialEvent: insertAuthorizationDenialEventSpy,
  resolveWorkspaceForAction: resolveWorkspaceForActionSpy,
}));
vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: isDatabaseConfiguredSpy,
}));

const packsService = await import("../lib/domains/packs/service");

describe("packs domain service", () => {
  it("validates mode before processing", async () => {
    const result = await packsService.importPolicyPackDecision({
      packId: "any",
      mode: "bad-mode",
      preserveCustomizations: false,
      requestedWorkspaceId: "",
    });

    expect(result).toEqual({ error: "Invalid mode. Expected install or upgrade." });
  });

  it("blocks install when connector pack already exists", async () => {
    const firstPack = POLICY_PACKS[0];
    expect(firstPack).toBeDefined();

    repositoryMocks.resolveWorkspaceForAction.mockResolvedValueOnce({
      id: "workspace-1",
      slug: "default",
    });
    repositoryMocks.findConnectorBranch.mockResolvedValueOnce({
      id: "branch-1",
      active_revision_id: "revision-1",
    });

    const result = await packsService.importPolicyPackDecision({
      packId: firstPack.id,
      mode: "install",
      preserveCustomizations: false,
      requestedWorkspaceId: "workspace-1",
    });

    expect(result).toEqual({
      error: "This connector pack is already installed. Use upgrade instead.",
    });
  });

  it("applies a parameter override to the persisted rules on install", async () => {
    const stripePack = POLICY_PACKS.find((p) => p.connector === "stripe");
    expect(stripePack).toBeDefined();
    const refundRule = stripePack!.rules.find((r) => r.stableRuleId === "stripe.refund.high_value_review");
    expect(refundRule?.parameterConstraints?.[0]).toMatchObject({ parameterKey: "stripe.refund_review_threshold_cents", value: 50000 });

    repositoryMocks.resolveWorkspaceForAction.mockResolvedValueOnce({ id: "workspace-1", slug: "default" });
    repositoryMocks.findConnectorBranch.mockResolvedValueOnce(null);
    persistPackInstallBranchSpy.mockResolvedValueOnce({
      branchId: "branch-stripe",
      revisionId: "revision-stripe-1",
      sourceHash: "sha256:stub",
      importedAt: "2026-07-21T00:00:00.000Z",
    });

    const result = await packsService.importPolicyPackDecision({
      packId: stripePack!.id,
      mode: "install",
      preserveCustomizations: false,
      requestedWorkspaceId: "workspace-1",
      parameterOverrides: { "stripe.refund_review_threshold_cents": 200000 },
    });

    expect("error" in result).toBe(false);
    const persistedCall = persistPackInstallBranchSpy.mock.calls[0][0];
    const persistedRefundRule = persistedCall.rules.find(
      (r: { stableRuleId: string }) => r.stableRuleId === "stripe.refund.high_value_review"
    );
    expect(persistedRefundRule.parameterConstraints[0].value).toBe(200000);

    // The persisted source/sourceDocument is the audit trail for the rules
    // being written — its *rule* content must reflect the override, not the
    // pack's unmodified defaults, and source_hash (computed by the repository
    // from this exact string) must be derived from that same overridden
    // content. (The pack's parameter catalog, which documents the original
    // default for reference, may still mention 50000 in metadata — that's
    // expected provenance, not the enforced value.)
    expect(persistedCall.source).toContain("200000");
    const documentRefundRule = (persistedCall.sourceDocument.rules as Array<{ stable_rule_id: string; parameter_constraints?: Array<{ value: unknown }> }>).find(
      (r) => r.stable_rule_id === "stripe.refund.high_value_review"
    );
    expect(documentRefundRule?.parameter_constraints?.[0]?.value).not.toBe(50000);
    expect(documentRefundRule?.parameter_constraints?.[0]?.value).toBe(200000);
    const expectedHash = `sha256:${createHash("sha256").update(persistedCall.source).digest("hex").slice(0, 16)}`;
    expect(expectedHash).toBe(
      `sha256:${createHash("sha256").update(JSON.stringify(persistedCall.sourceDocument, null, 2)).digest("hex").slice(0, 16)}`
    );

    // The pack's parameter catalog (labels/types/defaults/enum choices) must
    // reach the persisted provenance metadata, or a later UI/API has no way
    // to discover them for an installed pack even though overrides enforce
    // correctly.
    expect(persistedCall.metadata.parameters).toEqual(stripePack!.parameters);
  });

  it("carries a parameter override forward across an upgrade via preserveCustomizations", async () => {
    const stripePack = POLICY_PACKS.find((p) => p.connector === "stripe");
    expect(stripePack).toBeDefined();

    // Simulate a previously-installed revision whose refund-threshold rule
    // already carries an overridden value (200000, not the pack default of
    // 50000) — everything else identical to upstream.
    const previouslyOverriddenRules = stripePack!.rules.map((rule) =>
      rule.stableRuleId === "stripe.refund.high_value_review"
        ? {
            ...rule,
            sourceFormat: "AGT_YAML",
            parameterConstraints: [{ ...rule.parameterConstraints![0], value: 200000 }],
          }
        : { ...rule, sourceFormat: "AGT_YAML" }
    );

    repositoryMocks.resolveWorkspaceForAction.mockResolvedValueOnce({ id: "workspace-1", slug: "default" });
    repositoryMocks.findConnectorBranch.mockResolvedValueOnce({ id: "branch-stripe", active_revision_id: "revision-stripe-1" });
    repositoryMocks.listRulesForRevision.mockResolvedValueOnce(previouslyOverriddenRules);
    persistPackUpgradeRevisionSpy.mockResolvedValueOnce({
      revisionId: "revision-stripe-2",
      sourceHash: "sha256:stub2",
      importedAt: "2026-07-21T00:01:00.000Z",
    });

    const result = await packsService.importPolicyPackDecision({
      packId: stripePack!.id,
      mode: "upgrade",
      preserveCustomizations: true,
      requestedWorkspaceId: "workspace-1",
    });

    expect("error" in result).toBe(false);
    const persistedCall = persistPackUpgradeRevisionSpy.mock.calls[0][0];
    const persistedRefundRule = persistedCall.rules.find(
      (r: { stableRuleId: string }) => r.stableRuleId === "stripe.refund.high_value_review"
    );
    // The override must survive the upgrade — not silently reset to the
    // pack's hard-coded default (50000) because areRulesEquivalent ignored
    // parameterConstraints.
    expect(persistedRefundRule.parameterConstraints[0].value).toBe(200000);
  });

  it("an upgrade that moves a threshold surfaces the same reviewable operational diff as an authored change (not a silent replace)", async () => {
    const stripePack = POLICY_PACKS.find((p) => p.connector === "stripe")!;

    // Pre-upgrade active revision: pack defaults (refund threshold 50000).
    const beforeRules: PolicyRuleSummary[] = stripePack.rules.map((rule) => ({ ...rule, sourceFormat: "AGT_YAML" }));

    repositoryMocks.resolveWorkspaceForAction.mockResolvedValueOnce({ id: "workspace-1", slug: "default" });
    repositoryMocks.findConnectorBranch.mockResolvedValueOnce({ id: "branch-stripe", active_revision_id: "revision-stripe-1" });
    repositoryMocks.listRulesForRevision.mockResolvedValueOnce(beforeRules);
    persistPackUpgradeRevisionSpy.mockResolvedValueOnce({
      revisionId: "revision-stripe-2",
      sourceHash: "sha256:stub3",
      importedAt: "2026-07-21T00:02:00.000Z",
    });

    const result = await packsService.importPolicyPackDecision({
      packId: stripePack.id,
      mode: "upgrade",
      preserveCustomizations: true,
      requestedWorkspaceId: "workspace-1",
      parameterOverrides: { "stripe.refund_review_threshold_cents": 200000 },
    });
    expect("error" in result).toBe(false);

    // The rules the upgrade actually persisted become the "after" of the review
    // diff (review.ts diffs the new revision against its parent). Running the
    // SAME diffPolicyRules an authored revision uses must classify the threshold
    // move as a MODIFIED rule with parameterConstraints in changedFields.
    const afterRules = persistPackUpgradeRevisionSpy.mock.calls[0][0].rules as PolicyRuleSummary[];
    const diff = diffPolicyRules({
      branchId: "branch-stripe",
      baseRevisionId: "revision-stripe-1",
      compareRevisionId: "revision-stripe-2",
      before: beforeRules,
      after: afterRules,
    });

    const refundDiff = diff.rules.find((r) => r.stableRuleId === "stripe.refund.high_value_review");
    expect(refundDiff?.status).toBe("MODIFIED");
    expect(refundDiff?.changedFields).toContain("parameterConstraints");
    expect(refundDiff?.before?.parameterConstraints?.[0]?.value).toBe(50000);
    expect(refundDiff?.after?.parameterConstraints?.[0]?.value).toBe(200000);
    expect(diff.summary.modified).toBe(1);
  });
});

describe("buildAuthoringVocabulary", () => {
  it("extracts connector/action/domain/parameter vocabulary for installed connectors", () => {
    const vocab = packsService.buildAuthoringVocabulary(["stripe"]);
    expect(vocab).toHaveLength(1);
    const stripe = vocab[0];
    expect(stripe.connector).toBe("stripe");
    // Actions are unioned across the pack's rules and sorted.
    expect(stripe.actions).toContain("refund.create");
    expect(stripe.actions).toContain("payout.update_destination");
    expect(stripe.domains).toContain("refunds");
    // Overridable pack knobs carry through with their definitions.
    expect(stripe.parameters.map((p) => p.key)).toContain("stripe.refund_review_threshold_cents");
    // Fields observed in the pack's rule constraints seed the constraint editor.
    expect(stripe.constraintFields).toContain("amount_cents");
  });

  it("omits connectors that are not installed and produces no entries for unknown connectors", () => {
    expect(packsService.buildAuthoringVocabulary([])).toEqual([]);
    expect(packsService.buildAuthoringVocabulary(["connector-that-does-not-exist"])).toEqual([]);
  });

  it("omits the managed spctre-agent connector from normal authoring suggestions", () => {
    expect(packsService.buildAuthoringVocabulary(["spctre-agent"])).toEqual([]);
  });
});

describe("mergeObservedVocabulary", () => {
  it("extends a known connector's actions with observed pairs", () => {
    const packVocab = packsService.buildAuthoringVocabulary(["stripe"]);
    const merged = packsService.mergeObservedVocabulary(packVocab, [
      { connector: "stripe", action: "charge.capture" }, // new action on a known connector
    ]);
    const stripe = merged.find((e) => e.connector === "stripe")!;
    expect(stripe.actions).toContain("charge.capture");
    expect(stripe.actions).toContain("refund.create"); // pack action retained
    expect(stripe.parameters.length).toBeGreaterThan(0); // pack metadata preserved
  });

  it("adds a bare entry for a connector no installed pack covers", () => {
    const merged = packsService.mergeObservedVocabulary([], [
      { connector: "internal-tool", action: "run" },
      { connector: "internal-tool", action: "stop" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      connector: "internal-tool",
      domains: [],
      actions: ["run", "stop"],
      parameters: [],
      constraintFields: [],
    });
  });

  it("omits sample and managed platform actions from observed suggestions", () => {
    const merged = packsService.mergeObservedVocabulary([], [
      { connector: "sample", action: "payment.create" },
      { connector: "spctre-agent", action: "policy.publish" },
      { connector: "stripe", action: "refund.create" },
    ]);

    expect(merged).toEqual([
      expect.objectContaining({ connector: "stripe", actions: ["refund.create"] }),
    ]);
  });
});

describe("areRulesEquivalent (preserve-customizations detection)", () => {
  const base = {
    stableRuleId: "conn.rule",
    title: "Rule",
    effect: "DENY" as const,
    sourceFormat: "AGT_YAML",
    domains: ["a"],
    connectors: ["conn"],
    actions: ["do"],
    immutable: false,
    semanticChecks: [{ id: "sc-1", prompt: "block destructive intent" }],
    controlMappings: [{ framework: "SOC2" as const, controlId: "CC6.1" }],
    parameterConstraints: [{ field: "n", operator: "gte" as const, value: 5 }],
  };

  it("treats identical rules as equivalent", () => {
    expect(packsService.areRulesEquivalent({ ...base }, { ...base })).toBe(true);
  });

  it("detects a locally-edited semantic check as a customization (not equivalent)", () => {
    const edited = { ...base, semanticChecks: [{ id: "sc-1", prompt: "block destructive intent", effect: "DENY" as const }] };
    expect(packsService.areRulesEquivalent(edited, base)).toBe(false);
  });

  it("detects an edited control mapping as a customization", () => {
    const edited = { ...base, controlMappings: [{ framework: "SOC2" as const, controlId: "CC6.6" }] };
    expect(packsService.areRulesEquivalent(edited, base)).toBe(false);
  });

  it("detects an edited unmodeled field (priority) as a customization", () => {
    expect(packsService.areRulesEquivalent({ ...base, priority: 9 }, base)).toBe(false);
  });

  it("detects an AGT-native preserved-field customization (parser stores unknown fields there)", () => {
    const customized = { ...base, preservedFields: { agt_runtime: "bedrock" } };
    // Upstream pack rule has no such field; the local one must not be replaced.
    expect(packsService.areRulesEquivalent(customized, base)).toBe(false);
  });

  it("ignores document-location metadata (sourcePath/sourceFormat) and the derived originalRule duplicate", () => {
    const relocated = {
      ...base,
      sourcePath: "packs/other.json",
      sourceFormat: "OTHER",
      originalRule: { stable_rule_id: "conn.rule", raw: true },
    };
    expect(packsService.areRulesEquivalent(relocated, base)).toBe(true);
  });
});

describe("buildRuleSourceDocument (retained-customization fidelity)", () => {
  it("preserves unmodeled and AGT-native fields when rebuilding the source document", () => {
    const rule = {
      stableRuleId: "conn.rule",
      title: "Rule",
      effect: "DENY" as const,
      sourceFormat: "AGT_YAML",
      sourcePath: "packs/conn.json",
      domains: ["a"],
      connectors: ["conn"],
      actions: ["do"],
      immutable: false,
      priority: 7,
      semanticChecks: [{ id: "sc-1", prompt: "check" }],
      controlMappings: [{ framework: "SOC2" as const, controlId: "CC6.1" }],
      preservedFields: { agt_native_knob: "keep-me" },
      originalRule: { stable_rule_id: "conn.rule", raw: true },
    };
    const { sourceDocument } = packsService.buildRuleSourceDocument([rule]);
    const [doc] = sourceDocument.rules as Array<Record<string, unknown>>;

    expect(doc.stable_rule_id).toBe("conn.rule");
    expect(doc.priority).toBe(7); // unmodeled field retained
    expect(doc.agt_native_knob).toBe("keep-me"); // AGT-native preserved field retained
    expect(doc.semantic_checks).toEqual([{ id: "sc-1", prompt: "check" }]);
    expect(doc.control_mappings).toEqual([{ framework: "SOC2", controlId: "CC6.1" }]);
    // Document-location + derived-duplicate fields are omitted.
    expect(doc.sourceFormat).toBeUndefined();
    expect(doc.sourcePath).toBeUndefined();
    expect(doc.originalRule).toBeUndefined();
  });
});
