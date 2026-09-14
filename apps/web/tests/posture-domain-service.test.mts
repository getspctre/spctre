import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostureRuleRow } from "../lib/repositories/posture";

// The posture model turns five independent signals into a ranked list of
// findings and an overall status. It is what an operator is told to fix, and it
// had no test at all.
//
// Two properties carry the weight. Severity decides order and status: one HIGH
// finding puts the whole workspace AT_RISK, and a dimension with no findings is
// READY rather than absent. And every source is capped, so a workspace with a
// hundred drifted rules produces a list someone can act on rather than a wall.

const listPostureRuleRowsSpy = vi.fn();
const getHighFrictionRulesSpy = vi.fn();
const getUnusedActiveRulesSpy = vi.fn();
const listAgentSummariesSpy = vi.fn();
const getLatestPublishedBundleSpy = vi.fn();
const getRulesForRevisionSpy = vi.fn();
const getReviewArtifactsSpy = vi.fn();

vi.mock("@/lib/repositories/posture", () => ({ listPostureRuleRows: listPostureRuleRowsSpy }));
vi.mock("@/lib/repositories/policy", () => ({
  getHighFrictionRules: getHighFrictionRulesSpy,
  getUnusedActiveRules: getUnusedActiveRulesSpy,
  getReviewArtifacts: getReviewArtifactsSpy,
}));
vi.mock("@/lib/repositories/policy/publish", () => ({
  getLatestPublishedBundle: getLatestPublishedBundleSpy,
}));
vi.mock("@/lib/repositories/policy/rules", () => ({ getRulesForRevision: getRulesForRevisionSpy }));
vi.mock("@/lib/repositories/evidence", () => ({ listAgentSummaries: listAgentSummariesSpy }));

const { getPostureModel } = await import("../lib/domains/posture/service");

const PARAMS = { tenantId: "t-1", workspaceId: "w-1", workspaceSlug: "acme" };

function rule(overrides: Partial<PostureRuleRow> = {}): PostureRuleRow {
  return {
    workspaceId: "w-1",
    workspaceSlug: "acme",
    workspaceName: "Acme",
    branchId: "b-1",
    revisionId: "r-1",
    scope: "WORKSPACE",
    stableRuleId: "rule.one",
    title: "Rule one",
    effect: "DENY",
    domains: ["payments"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false,
    ...overrides,
  };
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent-1",
    runtimeStack: "LANGGRAPH",
    runtimeAdapter: "langgraph",
    currentArtifactHash: "sha256:aaa",
    latestPublishedHash: "sha256:aaa",
    ...overrides,
  };
}

/** No signals at all: every source empty, nothing published. */
function quiet() {
  listPostureRuleRowsSpy.mockResolvedValue({ orgRules: [], workspaceRules: [], workspaceCount: 0 });
  getHighFrictionRulesSpy.mockResolvedValue([]);
  getUnusedActiveRulesSpy.mockResolvedValue([]);
  listAgentSummariesSpy.mockResolvedValue([]);
  getLatestPublishedBundleSpy.mockResolvedValue(null);
  getRulesForRevisionSpy.mockResolvedValue([]);
  getReviewArtifactsSpy.mockResolvedValue(null);
}

/** A published artifact whose rules all carry control mappings. */
function published() {
  getLatestPublishedBundleSpy.mockResolvedValue({ branchId: "b-1", revisionId: "r-1" });
  getRulesForRevisionSpy.mockResolvedValue([
    { stableRuleId: "rule.one", controlMappings: ["SOC2-CC6.1"] },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  quiet();
});

describe("overall status", () => {
  it("is AT_RISK when any finding is HIGH", async () => {
    listAgentSummariesSpy.mockResolvedValue([agent({ latestPublishedHash: null })]);

    const model = await getPostureModel(PARAMS);

    expect(model.status).toBe("AT_RISK");
    expect(model.findings[0].severity).toBe("HIGH");
  });

  it("is ATTENTION when findings exist but none are HIGH", async () => {
    published();
    getUnusedActiveRulesSpy.mockResolvedValue([
      { stableRuleId: "rule.stale", connectors: ["stripe"] },
    ]);

    const model = await getPostureModel(PARAMS);

    expect(model.status).toBe("ATTENTION");
    expect(model.findings.every((f) => f.severity !== "HIGH")).toBe(true);
  });

  it("is READY when a published workspace has nothing outstanding", async () => {
    // Reachable only since the control-mapping branch stopped emitting an
    // affirmative finding: a positive statement is not something to act on, and
    // emitting one made every workspace in existence report ATTENTION.
    published();

    const model = await getPostureModel(PARAMS);

    expect(model.status).toBe("READY");
    expect(model.findings).toEqual([]);
    expect(model.summary).toBe("Declared policy, runtimes, and evidence signals are aligned.");
  });

  it("treats an unpublished workspace as something to act on", async () => {
    const model = await getPostureModel(PARAMS);

    expect(model.status).toBe("ATTENTION");
    expect(model.findings).toEqual([
      expect.objectContaining({ id: "pack-maturity", severity: "MEDIUM" }),
    ]);
  });
});

describe("severity ordering", () => {
  it("ranks HIGH before MEDIUM before LOW", async () => {
    published();
    listAgentSummariesSpy.mockResolvedValue([agent({ currentArtifactHash: "sha256:drifted" })]);
    listPostureRuleRowsSpy.mockResolvedValue({
      orgRules: [],
      workspaceRules: [rule({ stableRuleId: "rule.orphan" })],
      workspaceCount: 1,
    });
    getUnusedActiveRulesSpy.mockResolvedValue([
      { stableRuleId: "rule.stale", connectors: ["stripe"] },
    ]);

    const model = await getPostureModel(PARAMS);

    expect(model.findings.map((f) => f.severity)).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });

  it("counts the findings in the summary", async () => {
    published();
    getUnusedActiveRulesSpy.mockResolvedValue([
      { stableRuleId: "a", connectors: [] },
      { stableRuleId: "b", connectors: [] },
    ]);

    const model = await getPostureModel(PARAMS);

    expect(model.summary).toBe("2 prioritized findings need review.");
  });

  it("uses the singular for one finding", async () => {
    published();
    getUnusedActiveRulesSpy.mockResolvedValue([{ stableRuleId: "a", connectors: [] }]);

    const model = await getPostureModel(PARAMS);

    expect(model.summary).toBe("1 prioritized finding needs review.");
  });
});

describe("runtime provenance", () => {
  it("flags a runtime with no published hash", async () => {
    listAgentSummariesSpy.mockResolvedValue([agent({ latestPublishedHash: null })]);

    const model = await getPostureModel(PARAMS);
    const finding = model.findings.find((f) => f.id === "runtime-agent-1");

    expect(finding).toMatchObject({ dimension: "SCOPE_INTEGRITY", severity: "HIGH" });
    expect(finding?.affectedScope).toBe("langgraph");
  });

  it("flags a runtime whose artifact has drifted from the published one", async () => {
    listAgentSummariesSpy.mockResolvedValue([
      agent({ currentArtifactHash: "sha256:old", latestPublishedHash: "sha256:new" }),
    ]);

    const model = await getPostureModel(PARAMS);

    expect(model.findings.some((f) => f.id === "runtime-agent-1")).toBe(true);
  });

  it("says nothing about a runtime that matches", async () => {
    published();
    listAgentSummariesSpy.mockResolvedValue([agent()]);

    const model = await getPostureModel(PARAMS);

    expect(model.findings.some((f) => f.id.startsWith("runtime-"))).toBe(false);
  });

  it("falls back to the runtime stack when no adapter is declared", async () => {
    listAgentSummariesSpy.mockResolvedValue([
      agent({ runtimeAdapter: null, latestPublishedHash: null }),
    ]);

    const model = await getPostureModel(PARAMS);

    expect(model.findings[0].affectedScope).toBe("LANGGRAPH");
  });
});

describe("baseline drift", () => {
  it("flags a workspace rule whose shape differs from the organization baseline", async () => {
    published();
    listPostureRuleRowsSpy.mockResolvedValue({
      orgRules: [rule({ effect: "DENY" })],
      workspaceRules: [rule({ effect: "WARN" })],
      workspaceCount: 1,
    });

    const model = await getPostureModel(PARAMS);
    const finding = model.findings.find((f) => f.id.startsWith("baseline-"));

    expect(finding).toMatchObject({ dimension: "CONTROL_HEALTH", severity: "MEDIUM" });
    expect(finding?.detail).toBe("A workspace override needs an explicit review decision.");
  });

  it("distinguishes a workspace-only rule from an override", async () => {
    published();
    listPostureRuleRowsSpy.mockResolvedValue({
      orgRules: [],
      workspaceRules: [rule({ stableRuleId: "rule.local" })],
      workspaceCount: 1,
    });

    const model = await getPostureModel(PARAMS);

    expect(model.findings[0].detail).toBe(
      "This workspace-only rule has no organization baseline counterpart.",
    );
  });

  it("ignores ordering within a rule's own lists", async () => {
    // The comparison sorts before hashing, so a rule that differs only in the
    // order of its connectors is not drift. Without this the model would report
    // findings on every workspace whose rows came back in another order.
    published();
    listPostureRuleRowsSpy.mockResolvedValue({
      orgRules: [rule({ connectors: ["stripe", "github"], actions: ["a", "b"] })],
      workspaceRules: [rule({ connectors: ["github", "stripe"], actions: ["b", "a"] })],
      workspaceCount: 1,
    });

    const model = await getPostureModel(PARAMS);

    expect(model.findings.some((f) => f.id.startsWith("baseline-"))).toBe(false);
  });
});

describe("caps", () => {
  it.each([
    ["runtimes", 6, () => listAgentSummariesSpy, "runtime-"],
    ["unused rules", 4, () => getUnusedActiveRulesSpy, "unused-"],
  ])("caps %s at %i findings", async (_label, cap, spy, prefix) => {
    published();
    const many = Array.from({ length: cap + 5 }, (_unused, index) =>
      prefix === "runtime-"
        ? agent({ agentId: `agent-${index}`, latestPublishedHash: null })
        : { stableRuleId: `rule-${index}`, connectors: [] },
    );
    spy().mockResolvedValue(many);

    const model = await getPostureModel(PARAMS);

    expect(model.findings.filter((f) => f.id.startsWith(prefix))).toHaveLength(cap);
  });

  it("caps composition conflict notes at four", async () => {
    published();
    getReviewArtifactsSpy.mockResolvedValue({
      composition: { conflictNotes: ["a", "b", "c", "d", "e", "f"] },
    });

    const model = await getPostureModel(PARAMS);

    expect(model.findings.filter((f) => f.id.startsWith("composition-"))).toHaveLength(4);
  });
});

describe("control mapping maturity", () => {
  it("raises a finding when published rules lack mappings", async () => {
    getLatestPublishedBundleSpy.mockResolvedValue({ branchId: "b-1", revisionId: "r-1" });
    getRulesForRevisionSpy.mockResolvedValue([
      { stableRuleId: "a", controlMappings: [] },
      { stableRuleId: "b", controlMappings: ["SOC2-CC6.1"] },
    ]);

    const model = await getPostureModel(PARAMS);

    expect(model.findings).toEqual([
      expect.objectContaining({
        id: "control-mappings",
        severity: "LOW",
        title: "1 published rule lacks control mappings",
      }),
    ]);
  });

  it("says nothing at all when every published rule is mapped", async () => {
    published();

    const model = await getPostureModel(PARAMS);

    expect(model.findings).toEqual([]);
  });
});

describe("dimensions", () => {
  it("always reports all three, in a fixed order", async () => {
    published();

    const model = await getPostureModel(PARAMS);
    const byId = Object.fromEntries(model.dimensions.map((d) => [d.id, d.status]));

    expect(model.dimensions.map((d) => d.id)).toEqual([
      "CONTROL_HEALTH",
      "SCOPE_INTEGRITY",
      "OPERATIONAL_EFFICIENCY",
    ]);
    expect(model.dimensions.every((d) => d.status === "READY")).toBe(true);
    expect(byId.CONTROL_HEALTH).toBe("READY");
  });

  it("marks only the dimension carrying a HIGH finding as AT_RISK", async () => {
    published();
    listAgentSummariesSpy.mockResolvedValue([agent({ latestPublishedHash: null })]);
    getUnusedActiveRulesSpy.mockResolvedValue([{ stableRuleId: "a", connectors: [] }]);

    const model = await getPostureModel(PARAMS);
    const byId = Object.fromEntries(model.dimensions.map((d) => [d.id, d.status]));

    expect(byId.SCOPE_INTEGRITY).toBe("AT_RISK");
    expect(byId.OPERATIONAL_EFFICIENCY).toBe("ATTENTION");
    expect(byId.CONTROL_HEALTH).toBe("READY");
  });
});

describe("degraded sources", () => {
  it("still produces a model when every read fails", async () => {
    // Each read is individually swallowed, so a posture page must render from
    // whatever answered rather than failing whole.
    listPostureRuleRowsSpy.mockRejectedValue(new Error("db down"));
    getHighFrictionRulesSpy.mockRejectedValue(new Error("db down"));
    getUnusedActiveRulesSpy.mockRejectedValue(new Error("db down"));
    listAgentSummariesSpy.mockRejectedValue(new Error("db down"));
    getLatestPublishedBundleSpy.mockRejectedValue(new Error("db down"));

    const model = await getPostureModel(PARAMS);

    expect(model.status).toBe("ATTENTION");
    expect(model.dimensions).toHaveLength(3);
  });
});
