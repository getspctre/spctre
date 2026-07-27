import { describe, expect, it, vi } from "vitest";
import type { PolicyRuleSummary, RuntimeDecisionEvidenceRecord } from "@spctre/policy-schema";
import type { PublishedRevisionRow } from "@/lib/repositories/evidence/compliance";

const published: PublishedRevisionRow = {
  publish_id: "pub-2",
  branch_id: "br-1",
  revision_id: "rev-2",
  artifact_hash: "sha256:art2",
  published_by: "author-1",
  published_at: new Date("2026-07-10T00:00:00.000Z"),
  source_format: "SPCTRE_MANAGED",
  source_hash: "sha256:src2",
  target_stacks: [],
  author_id: "author-1",
  message: "publish rev-2",
  revision_created_at: new Date("2026-07-09T00:00:00.000Z"),
};

const controlMappedRule: PolicyRuleSummary = {
  stableRuleId: "github.branch.force_push_protected.block",
  title: "Block force-pushing to a protected branch",
  effect: "DENY",
  sourceFormat: "SPCTRE_MANAGED",
  domains: ["branches"],
  connectors: ["github"],
  actions: ["branch.push"],
  immutable: true,
  controlMappings: [{ framework: "SOC2", controlId: "CC6.1", rationale: "Prevents unreviewed history rewrite." }],
};

function evidenceRecord(overrides: Partial<RuntimeDecisionEvidenceRecord>): RuntimeDecisionEvidenceRecord {
  return {
    decisionId: "decision-1",
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    environment: "production",
    runtimeTarget: { stack: "CUSTOM", adapter: "test" },
    agentId: "agent-1",
    connector: "github",
    action: "branch.push",
    status: "DENY",
    reason: "blocked",
    policyRefs: ["github.branch.force_push_protected.block"],
    artifactHash: "sha256:art2",
    policyContext: [],
    latencyMs: 1,
    createdAt: "2026-07-10T12:00:00.000Z",
    rawEvidence: {},
    ...overrides,
  };
}

const getLatestPublishAndRevisionMock = vi.fn(async () => published);
const listRulesForRevisionMock = vi.fn(async () => [controlMappedRule]);
const getApprovalsMock = vi.fn(async () => []);
const listRuntimeEvidenceMock = vi.fn();
const listApprovalTimelineEventsMock = vi.fn(async () => []);
const listResolvedEscalationsForRevisionMock = vi.fn(async () => []);
const listActionReceiptsMock = vi.fn(async () => []);

vi.mock("@/lib/repositories/evidence/compliance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/evidence/compliance")>();
  return { ...actual, getLatestPublishAndRevision: getLatestPublishAndRevisionMock };
});
vi.mock("@/lib/repositories/shared/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/shared/rules")>();
  return { ...actual, listRulesForRevision: listRulesForRevisionMock };
});
vi.mock("@/lib/repositories/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/policy")>();
  return { ...actual, getApprovals: getApprovalsMock };
});
vi.mock("@/lib/repositories/evidence/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/evidence/runtime")>();
  return { ...actual, listRuntimeEvidence: listRuntimeEvidenceMock };
});
vi.mock("@/lib/repositories/shared/revisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/shared/revisions")>();
  return { ...actual, listApprovalTimelineEvents: listApprovalTimelineEventsMock };
});
vi.mock("@/lib/repositories/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/gateway")>();
  return { ...actual, listResolvedEscalationsForRevision: listResolvedEscalationsForRevisionMock };
});
vi.mock("@/lib/repositories/action-receipts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/action-receipts")>();
  return { ...actual, listActionReceipts: listActionReceiptsMock };
});

const { getCompliancePacket } = await import("../lib/domains/compliance/service");

describe("getCompliancePacket controlEvidenceRollup", () => {
  it("excludes evidence from a different branch/revision even when it shares a stable rule ID", async () => {
    listRuntimeEvidenceMock.mockResolvedValue([
      // Governed by the currently published branch/revision — should count.
      evidenceRecord({
        decisionId: "decision-current",
        policyContext: [{ scope: "CONNECTOR", branchId: "br-1", revisionId: "rev-2", artifactHash: "sha256:art2" }],
      }),
      // Same stable rule ID, but from a prior/different revision on the same
      // branch — must NOT be counted as proof the current control operated.
      evidenceRecord({
        decisionId: "decision-old-revision",
        policyContext: [{ scope: "CONNECTOR", branchId: "br-1", revisionId: "rev-1", artifactHash: "sha256:art1" }],
      }),
      // Same stable rule ID, different branch entirely — must NOT count.
      evidenceRecord({
        decisionId: "decision-other-branch",
        policyContext: [{ scope: "CONNECTOR", branchId: "br-other", revisionId: "rev-2", artifactHash: "sha256:artX" }],
      }),
    ]);

    const packet = await getCompliancePacket("ws-1", "tenant-1");

    expect(packet).not.toBeNull();
    const rollup = packet!.controlEvidenceRollup;
    expect(rollup).toHaveLength(1);
    expect(rollup[0]).toMatchObject({ framework: "SOC2", controlId: "CC6.1", decisionCount: 1, deniedCount: 1 });
  });
});
