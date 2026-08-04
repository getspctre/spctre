import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeDecisionEvidenceRecord } from "@spctre/policy-schema";

const listRuntimeEvidenceMock = vi.fn();
const getLatestRevisionMetadataMock = vi.fn();
const getLatestRevisionMetadataForBranchMock = vi.fn();
const getRevisionMetadataMock = vi.fn();
const revisionBelongsToWorkspaceMock = vi.fn();
const listRulesForRevisionMock = vi.fn(async () => []);

vi.mock("@/lib/repositories/evidence/runtime", () => ({
  listRuntimeEvidence: listRuntimeEvidenceMock,
}));
vi.mock("@/lib/repositories/shared/revisions", () => ({
  getLatestRevisionMetadata: getLatestRevisionMetadataMock,
  getLatestRevisionMetadataForBranch: getLatestRevisionMetadataForBranchMock,
  getRevisionMetadata: getRevisionMetadataMock,
  revisionBelongsToWorkspace: revisionBelongsToWorkspaceMock,
}));
vi.mock("@/lib/repositories/shared/rules", () => ({
  listRulesForRevision: listRulesForRevisionMock,
}));

const { getEvidenceSimulationRun } = await import("../lib/repositories/evidence/simulation");

const scoutRevision = {
  branchId: "branch-scout",
  revisionId: "revision-scout",
  sourceFormat: "SPCTRE_MANAGED" as const,
  sourceHash: "sha256:scout",
  targetStacks: [],
};

const evidence: RuntimeDecisionEvidenceRecord = {
  decisionId: "decision-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  environment: "staging",
  runtimeTarget: { stack: "CUSTOM" },
  agentId: "agent-1",
  connector: "acquisition-scout",
  action: "lead.enrich",
  status: "ALLOW",
  reason: "Allowed by the current policy.",
  policyRefs: [],
  artifactHash: "sha256:current",
  policyContext: [],
  latencyMs: 1,
  createdAt: "2026-07-31T00:00:00.000Z",
  rawEvidence: {},
};

describe("evidence simulation revision selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRuntimeEvidenceMock.mockResolvedValue([evidence]);
    getLatestRevisionMetadataForBranchMock.mockResolvedValue(scoutRevision);
  });

  it("uses the selected branch's newest revision when no revision is supplied", async () => {
    const result = await getEvidenceSimulationRun(
      "branch-scout",
      undefined,
      "workspace-1",
      "tenant-1",
    );

    expect(getLatestRevisionMetadataForBranchMock).toHaveBeenCalledWith(
      "branch-scout",
      "workspace-1",
      "tenant-1",
    );
    expect(getLatestRevisionMetadataMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ branchId: "branch-scout", revisionId: "revision-scout" });
  });

  it("does not substitute the workspace's newest revision for an invalid branch selection", async () => {
    getLatestRevisionMetadataForBranchMock.mockResolvedValue(null);

    const result = await getEvidenceSimulationRun(
      "branch-missing",
      undefined,
      "workspace-1",
      "tenant-1",
    );

    expect(result).toBeNull();
    expect(getLatestRevisionMetadataMock).not.toHaveBeenCalled();
  });
});
