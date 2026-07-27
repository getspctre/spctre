/**
 * Failure-mode tests for §28 Phase 3 — covers degradation scenarios not
 * addressed by the happy-path and idempotency suites.
 *
 * Workflows covered:
 *   1. Publish gating — approval not satisfied
 *   2. Publish gating — open gateway escalations blocking publish
 *   3. Evidence pipeline — schema validation rejection
 *   4. SLO threshold contracts
 *
 * Token refresh DB-unavailable test lives in token-refresh-db-unavailable.test.mts
 * (isolated vi.mock for sql: null cannot coexist with the publish mocks here).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Review repository mock — controls all DB-layer calls made by publishRevisionDecision ──

const getPublishBranchScopeMock = vi.fn();
const revisionExistsOnPublishBranchMock = vi.fn();
const getApprovalsMock = vi.fn();
const getOpenEscalationSummaryMock = vi.fn();
const getExistingPublishArtifactHashMock = vi.fn();
const insertPolicyPublishMock = vi.fn();
const insertAuthorizationDenialEventMock = vi.fn();
const appendOperationsLogMock = vi.fn().mockResolvedValue(undefined);
const getLatestManagedSimulationRegressionMock = vi.fn();

vi.mock("@/lib/repositories/policy", () => ({
  getPublishBranchScope: getPublishBranchScopeMock,
  revisionExistsOnPublishBranch: revisionExistsOnPublishBranchMock,
  getApprovals: getApprovalsMock,
  getExistingPublishArtifactHash: getExistingPublishArtifactHashMock,
  insertPolicyPublish: insertPolicyPublishMock,
  getRevisionWorkspaceScope: vi.fn(),
  upsertApprovalForRevision: vi.fn(),
}));
vi.mock("@/lib/repositories/gateway", () => ({
  getOpenEscalationSummaryForRevision: getOpenEscalationSummaryMock,
}));
vi.mock("@/lib/repositories/workspace", () => ({
  insertAuthorizationDenialEvent: insertAuthorizationDenialEventMock,
}));
vi.mock("@/lib/repositories/approval-workflow", () => ({
  getApprovalWorkflowForContext: vi.fn().mockResolvedValue({
    id: "default-static-approval-workflow",
    name: "Default approval workflow",
    reviewMode: "PARALLEL",
    workspaceId: undefined,
    environment: undefined,
    rules: [],
    generatedAt: new Date().toISOString(),
  }),
  approvalRulesFromWorkflow: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/repositories/operations-log", () => ({
  appendOperationsLog: appendOperationsLogMock,
}));
vi.mock("@/lib/repositories/evidence", () => ({
  getLatestManagedSimulationRegression: getLatestManagedSimulationRegressionMock,
}));

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: vi.fn().mockResolvedValue({
    tenantId: "t-1",
    workspaceId: "ws-1",
    workspaceSlug: "ws-one",
    tenantSlug: "t-one",
  }),
}));

vi.mock("@/lib/actors", () => ({
  canActorReviewRole: vi.fn(),
  getActiveActor: vi.fn().mockResolvedValue({
    actor: { id: "actor-1", role: "OWNER", name: "Owner" },
  }),
  getBranchPermissions: vi.fn().mockReturnValue({ canPublish: true }),
  requireActorAdminWorkspace: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock("@/lib/approval-config", () => ({
  REQUIRED_APPROVAL_RULES: [],
  ALL_REVIEWER_ROLES: [],
}));

const evaluatePublishReadinessMock = vi.fn();

vi.mock("@spctre/policy-schema", async (importOriginal) => {
  const real = await importOriginal<typeof import("@spctre/policy-schema")>();
  return { ...real, evaluatePublishReadiness: evaluatePublishReadinessMock };
});

const { publishRevisionDecision } = await import("../lib/domains/review/service");

const BRANCH_ROW = {
  workspace_id: "ws-1",
  scope: "WORKSPACE",
  environment: "production",
  workspace_slug: "ws-one",
};

// ── 1. Publish gating: approval not satisfied ─────────────────────────────────

describe("Publish gating — approval not satisfied", () => {
  beforeEach(() => {
    getPublishBranchScopeMock.mockResolvedValue(BRANCH_ROW);
    revisionExistsOnPublishBranchMock.mockResolvedValue(true);
    getApprovalsMock.mockResolvedValue([]);
    getOpenEscalationSummaryMock.mockResolvedValue({ count: 0, nearestSlaDueAt: null });
    getExistingPublishArtifactHashMock.mockResolvedValue(null);
    insertPolicyPublishMock.mockResolvedValue(undefined);
    appendOperationsLogMock.mockClear();
    getLatestManagedSimulationRegressionMock.mockResolvedValue(null);
    delete process.env.GATEWAY_ENABLED;
    delete process.env.SPCTRE_PLAN;
  });

  it("returns an error when required approvals are missing", async () => {
    evaluatePublishReadinessMock.mockReturnValue({
      branchId: "branch-1",
      revisionId: "rev-1",
      isReady: false,
      status: "PENDING_APPROVAL",
      satisfiedRoles: [],
      missingRoles: ["Security"],
      blockingReasons: [{ message: "Missing approval from Security reviewer.", href: "#reviews", cta: "Open reviews" }],
      approvals: [],
    });

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/missing approval/i);
    }
  });

  it("joins all blocking reasons when multiple are present", async () => {
    evaluatePublishReadinessMock.mockReturnValue({
      branchId: "branch-1",
      revisionId: "rev-1",
      isReady: false,
      status: "PENDING_APPROVAL",
      satisfiedRoles: [],
      missingRoles: ["Security", "Legal"],
      blockingReasons: [
        { message: "Missing approval from Security reviewer.", href: "#reviews", cta: "Open reviews" },
        { message: "Missing approval from Legal reviewer.", href: "#reviews", cta: "Open reviews" },
      ],
      approvals: [],
    });

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });
    if ("error" in result) {
      expect(result.error).toContain("Security");
      expect(result.error).toContain("Legal");
    }
  });
});

// ── 2. Publish gating: open gateway escalations ───────────────────────────────

describe("Publish gating — open gateway escalations", () => {
  beforeEach(() => {
    getPublishBranchScopeMock.mockResolvedValue(BRANCH_ROW);
    revisionExistsOnPublishBranchMock.mockResolvedValue(true);
    getApprovalsMock.mockResolvedValue([]);
    getExistingPublishArtifactHashMock.mockResolvedValue(null);
    insertPolicyPublishMock.mockResolvedValue(undefined);
    evaluatePublishReadinessMock.mockReturnValue({
      branchId: "branch-1",
      revisionId: "rev-1",
      isReady: true,
      status: "READY",
      satisfiedRoles: [],
      missingRoles: [],
      blockingReasons: [],
      approvals: [],
    });
    delete process.env.GATEWAY_ENABLED;
    delete process.env.SPCTRE_PLAN;
    getLatestManagedSimulationRegressionMock.mockResolvedValue(null);
  });

  it("blocks publish when unresolved escalations exist and gateway is enabled", async () => {
    process.env.GATEWAY_ENABLED = "true";
    getOpenEscalationSummaryMock.mockResolvedValue({
      count: 3,
      nearestSlaDueAt: "2026-05-11T20:00:00.000Z",
    });

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/escalation/i);
      expect(result.error).toContain("3");
    }
  });

  it("does not block when gateway is disabled even with open escalations", async () => {
    delete process.env.GATEWAY_ENABLED;
    getOpenEscalationSummaryMock.mockResolvedValue({ count: 5, nearestSlaDueAt: null });

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });
    expect(result).toHaveProperty("artifactHash");
  });

  it("does not block when gateway is enabled but no escalations are open", async () => {
    process.env.GATEWAY_ENABLED = "true";
    getOpenEscalationSummaryMock.mockResolvedValue({ count: 0, nearestSlaDueAt: null });

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });
    expect(result).toHaveProperty("artifactHash");
  });

  it("blocks Cloud publish until a retained-log replay exists for the revision", async () => {
    process.env.SPCTRE_PLAN = "cloud";
    getLatestManagedSimulationRegressionMock.mockResolvedValue(null);

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });

    expect(result).toEqual({ error: expect.stringMatching(/managed retained-log simulation/i) });
  });

  it("blocks Cloud publish when retained-log replay reports regressions", async () => {
    process.env.SPCTRE_PLAN = "enterprise";
    getLatestManagedSimulationRegressionMock.mockResolvedValue({
      coverage: "RETAINED_LOG",
      newlyDeniedExpectedWorkCount: 2,
      removedEscalationCoverageCount: 1,
      newlyAllowedHighRiskCount: 3,
      blockingCount: 6,
    });

    const result = await publishRevisionDecision({ branchId: "branch-1", revisionId: "rev-1" }, { tenantId: "t-1", workspaceId: "ws-1" });

    expect(result).toEqual({ error: expect.stringMatching(/6 regression/i) });
  });
});

// ── 3. Evidence pipeline: schema validation ────────────────────────────────────

import { EvidenceIngestSchema, parseBody } from "@spctre/api-contracts";

const VALID_EVIDENCE_PAYLOAD = {
  decisionId: "d-valid-1",
  status: "ALLOW",
  reason: "Policy allows this action.",
  environment: "production",
  connector: "claude-code",
  action: "tool.read_file",
  agentId: "agent-1",
  runtimeTarget: { stack: "LOCAL" },
  policyRefs: ["policy-ref-1"],
  artifactHash: "sha256:abc123",
  policyContext: [{
    scope: "WORKSPACE",
    branchId: "branch-1",
    revisionId: "rev-1",
    artifactHash: "sha256:abc123",
  }],
};

describe("Evidence pipeline — schema validation", () => {
  it("rejects a payload missing required decisionId", () => {
    const result = parseBody(EvidenceIngestSchema, { tenantId: "t-1", status: "ALLOW" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues?.length).toBeGreaterThan(0);
  });

  it("rejects a payload with an invalid status value", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...VALID_EVIDENCE_PAYLOAD,
      status: "INVALID_STATUS",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with an invalid runtimeTarget stack", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...VALID_EVIDENCE_PAYLOAD,
      runtimeTarget: { stack: "claude-code" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with empty policyRefs", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...VALID_EVIDENCE_PAYLOAD,
      policyRefs: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with empty policyContext", () => {
    const result = parseBody(EvidenceIngestSchema, {
      ...VALID_EVIDENCE_PAYLOAD,
      policyContext: [],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a minimal valid evidence payload", () => {
    const result = parseBody(EvidenceIngestSchema, VALID_EVIDENCE_PAYLOAD);
    expect(result.ok).toBe(true);
  });
});

// ── 4. SLO threshold contracts ─────────────────────────────────────────────────

import { SLO_THRESHOLDS, SLOW_QUERY_THRESHOLD_MS, isSloViolation } from "@spctre/platform";

describe("SLO thresholds — contract assertions", () => {
  it("evidence.ingest p95 is at most 500ms", () => {
    expect(SLO_THRESHOLDS["evidence.ingest"].p95Ms).toBeLessThanOrEqual(500);
  });

  it("token.refresh p95 is at most 100ms", () => {
    expect(SLO_THRESHOLDS["token.refresh"].p95Ms).toBeLessThanOrEqual(100);
  });

  it("all workflows have error rate threshold below 10%", () => {
    for (const [name, thresholds] of Object.entries(SLO_THRESHOLDS)) {
      expect(thresholds.errorRateThreshold).toBeLessThan(0.1);
      expect(name).toBeTruthy();
    }
  });

  it("slow query threshold is positive and at most 200ms", () => {
    expect(SLOW_QUERY_THRESHOLD_MS).toBeGreaterThan(0);
    expect(SLOW_QUERY_THRESHOLD_MS).toBeLessThanOrEqual(200);
  });

  it("isSloViolation returns true when duration exceeds p95 threshold", () => {
    const { p95Ms } = SLO_THRESHOLDS["evidence.ingest"];
    expect(isSloViolation("evidence.ingest", p95Ms + 1, "p95")).toBe(true);
    expect(isSloViolation("evidence.ingest", p95Ms - 1, "p95")).toBe(false);
  });

  it("isSloViolation returns false for unknown workflows", () => {
    expect(isSloViolation("unknown.workflow", 99999, "p95")).toBe(false);
  });
});
