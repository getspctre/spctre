import { beforeEach, describe, expect, it, vi } from "vitest";

// Define Spy/Mock functions before any imports
const getAuthSessionSpy = vi.fn();
const getWorkspaceContextSpy = vi.fn();
const getRequiredWorkspaceContextSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const updateSessionForActorSwitchSpy = vi.fn();
const runSimulationDecisionSpy = vi.fn();
const generateSimulationChangeRecommendationDecisionSpy = vi.fn();
const applySimulationChangeDecisionSpy = vi.fn();
const claimEscalationDecisionSpy = vi.fn();
const resolveEscalationDecisionSpy = vi.fn();
const importPolicyPackDecisionSpy = vi.fn();

// Set up mocks for standard Next.js and web app components
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: "session-123" }),
    set: () => {},
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: getAuthSessionSpy,
  SESSION_COOKIE: "spctre_session_id",
  sessionTtlHours: () => 24,
}));

vi.mock("@/lib/session-guard", () => ({
  SESSION_GUARD_COOKIE: "spctre_session_guard",
  createSessionGuardToken: async () => "guard-token",
}));

vi.mock("@/lib/workspace/server-context", () => ({
  getWorkspaceContext: getWorkspaceContextSpy,
  getRequiredWorkspaceContext: getRequiredWorkspaceContextSpy,
}));

vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: () => true,
}));

// Mock repositories and domain services to prevent real DB queries
vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  DEMO_WORKSPACE_ID: "00000000-0000-0000-0000-000000000002",
}));

vi.mock("@/lib/repositories/auth/session", () => ({
  ensureAuthDemoTenant: async () => {},
  updateSessionForTenantSwitch: async () => {},
  updateSessionForActorSwitch: updateSessionForActorSwitchSpy,
}));

vi.mock("@/lib/repositories/mfa", () => ({
  getTenantRequireMfa: async () => false,
}));

vi.mock("@/lib/repositories/auth/principal", () => ({
  getPrincipalSubject: async () => "user@example.com",
}));

vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: async () => null,
}));

vi.mock("@/lib/actors", () => ({
  findActorById: findActorByIdSpy,
  getActiveActor: async () => ({
    actor: {
      id: "p-123",
      reviewerRoles: ["Admin"],
    },
  }),
  requireActorAdminWorkspace: () => ({ allowed: true }),
}));

vi.mock("@/lib/repositories/workspace", () => ({
  verifyWorkspaceOwnership: async () => true,
  listWorkspaceSlugsWithPrefix: async () => [],
  insertWorkspace: async () => {},
  getFirstWorkspaceId: async () => "w-123",
  insertAdminAuditEvent: async () => {},
  insertAuthorizationDenialEvent: async () => {},
  countTenantWorkspaces: async () => 0,
  getCommercialProfile: async () => ({ planCode: "TEAM", lifecycleStatus: "ACTIVE", salesStatus: "CUSTOMER" }),
}));

vi.mock("@/lib/repositories/policy", () => ({
  getBranchWithPublishStatus: async () => ({
    has_published_revision: false,
  }),
  deletePolicyBranch: async () => {},
  getRevisionForDraft: async () => ({
    workspace_id: "w-123",
    workspace_slug: "demo",
    source_format: "JSON",
    source_path: "policy.yaml",
    source_document: {},
  }),
  createDraftRevision: async () => {},
  getBranchForRollback: async () => ({
    workspace_id: "w-123",
    workspace_slug: "demo",
  }),
  createCommittedRevision: async () => {},
}));

vi.mock("@/lib/domains/policy/service", () => ({
  createPolicyBranchDecision: async () => ({
    branchId: "branch-123",
    revisionId: "revision-123",
  }),
  importPolicyDecision: async () => ({
    result: { rulesImported: 5 },
  }),
  rollbackBranchDecision: async () => ({
    artifactHash: "hash-123",
    revisionId: "rev-123",
  }),
  deleteUnpublishedBranchDecision: async () => ({
    success: true,
  }),
}));

vi.mock("@/lib/domains/review/service", () => ({
  addApprovalDecision: async () => ({
    ok: true,
  }),
  publishRevisionDecision: async () => ({
    artifactHash: "hash-999",
  }),
  createDraftRuleRevisionDecision: async () => ({
    revisionId: "draft-rev-123",
    sourceHash: "hash-draft-123",
    ruleCount: 2,
  }),
  commitRuleRevisionDecision: async () => ({
    revisionId: "commit-rev-123",
    sourceHash: "hash-commit-123",
    ruleCount: 2,
  }),
}));

vi.mock("@/lib/domains/evidence/service", () => ({
  runSimulationDecision: runSimulationDecisionSpy,
}));

vi.mock("@/lib/domains/simulation-change/service", () => ({
  generateSimulationChangeRecommendation: generateSimulationChangeRecommendationDecisionSpy,
  applySimulationChangeDecision: applySimulationChangeDecisionSpy,
}));

vi.mock("@/lib/domains/gateway/service", () => ({
  claimEscalationDecision: claimEscalationDecisionSpy,
  resolveEscalationDecision: resolveEscalationDecisionSpy,
}));

vi.mock("@/lib/domains/packs/service", () => ({
  importPolicyPackDecision: importPolicyPackDecisionSpy,
}));

// Load the server actions dynamically
const { createWorkspace, setActiveActor } = await import("../app/workspace-actions");
const { deleteBranchAdmin } = await import("../app/branch-actions");
const { createPolicyBranch, importPolicy } = await import("../app/policy/actions");
const {
  runSimulation,
  generateSimulationChangeRecommendation,
  applySimulationChangeRecommendation,
} = await import("../app/evidence/actions");
const {
  claimEscalation,
  resolveEscalation,
} = await import("../app/escalations/actions");
const { importPolicyPack } = await import("../app/packs/actions");
const {
  addApproval,
  rollbackBranch,
  publishRevision,
} = await import("../app/review/publish-actions");
const {
  createDraftRuleRevision,
  commitRuleRevision,
} = await import("../app/review/rule-actions");

describe("Demo Write Guard - Premium Onboarding CTA Block", () => {
  const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
  const REGULAR_TENANT = "10000000-0000-0000-0000-000000000001";
  const FRIENDLY_ERROR = "This action is read-only in Demo Mode. Create a free Spctre Cloud account to save changes!";

  beforeEach(() => {
    vi.clearAllMocks();
    findActorByIdSpy.mockResolvedValue({
      id: "p-123",
      reviewerRoles: ["Admin", "Security", "Platform"],
    });
    runSimulationDecisionSpy.mockResolvedValue({
      newlyDenied: 0,
      newlyAllowed: 0,
      unchanged: 1,
      total: 1,
      branchId: "b-1",
      revisionId: "rev-1",
      runId: "run-1",
    });
    generateSimulationChangeRecommendationDecisionSpy.mockResolvedValue({
      ok: true,
      recommendation: { id: "rec-sim" },
    });
    applySimulationChangeDecisionSpy.mockResolvedValue({ ok: true });
    claimEscalationDecisionSpy.mockResolvedValue({ ok: true });
    resolveEscalationDecisionSpy.mockResolvedValue({ ok: true });
    importPolicyPackDecisionSpy.mockResolvedValue({
      result: { rulesImported: 3 },
      workspaceSlug: "regular",
    });
  });

  describe("Under DEMO_TENANT_ID", () => {
    beforeEach(() => {
      getAuthSessionSpy.mockResolvedValue({
        sessionId: "session-123",
        tenantId: DEMO_TENANT,
        principalId: "p-123",
        subject: "user@example.com",
        requireMfa: false,
      });

      getWorkspaceContextSpy.mockResolvedValue({
        tenantId: DEMO_TENANT,
        workspaceId: "w-123",
        workspaceSlug: "demo",
      });

      getRequiredWorkspaceContextSpy.mockResolvedValue({
        tenantId: DEMO_TENANT,
        workspaceId: "w-123",
        workspaceSlug: "demo",
      });
    });

    it("blocks workspace-actions -> createWorkspace", async () => {
      const formData = new FormData();
      formData.set("workspaceName", "New Workspace");
      const result = await createWorkspace(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks branch-actions -> deleteBranchAdmin", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-123");
      formData.set("confirm", "DELETE");
      const result = await deleteBranchAdmin(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks policy-actions -> importPolicy", async () => {
      const formData = new FormData();
      formData.set("source", "rules:\n  - stableRuleId: r1");
      const result = await importPolicy(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks policy-actions -> createPolicyBranch", async () => {
      const formData = new FormData();
      formData.set("branchName", "new-policy");
      const result = await createPolicyBranch(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks publish-actions -> addApproval", async () => {
      const formData = new FormData();
      formData.set("revisionId", "rev-1");
      const result = await addApproval(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks publish-actions -> rollbackBranch", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      const result = await rollbackBranch(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks publish-actions -> publishRevision", async () => {
      const formData = new FormData();
      formData.set("revisionId", "rev-1");
      const result = await publishRevision(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks rule-actions -> createDraftRuleRevision", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("baseRevisionId", "rev-1");
      const result = await createDraftRuleRevision(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks rule-actions -> commitRuleRevision", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("parentRevisionId", "rev-1");
      formData.set("rulesPayload", JSON.stringify([{ stableRuleId: "r1", title: "Rule 1", effect: "ALLOW" }]));
      const result = await commitRuleRevision(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
    });

    it("blocks evidence-actions -> runSimulation", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("revisionId", "rev-1");
      const result = await runSimulation(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
      expect(runSimulationDecisionSpy).not.toHaveBeenCalled();
    });

    it("blocks evidence-actions -> generateSimulationChangeRecommendation", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("revisionId", "rev-1");
      const result = await generateSimulationChangeRecommendation(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
      expect(generateSimulationChangeRecommendationDecisionSpy).not.toHaveBeenCalled();
    });

    it("blocks evidence-actions -> applySimulationChangeRecommendation", async () => {
      const formData = new FormData();
      formData.set("decision", "ACCEPT");
      const result = await applySimulationChangeRecommendation(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
      expect(applySimulationChangeDecisionSpy).not.toHaveBeenCalled();
    });

    it("blocks escalations-actions -> claimEscalation", async () => {
      const formData = new FormData();
      formData.set("queueId", "q-1");
      const result = await claimEscalation(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
      expect(claimEscalationDecisionSpy).not.toHaveBeenCalled();
    });

    it("blocks escalations-actions -> resolveEscalation", async () => {
      const formData = new FormData();
      formData.set("queueId", "q-1");
      formData.set("resolutionOutcome", "PROCEED");
      const result = await resolveEscalation(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
      expect(resolveEscalationDecisionSpy).not.toHaveBeenCalled();
    });

    it("blocks packs-actions -> importPolicyPack", async () => {
      const formData = new FormData();
      formData.set("packId", "pack-1");
      const result = await importPolicyPack(null, formData);
      expect(result).toEqual({ error: FRIENDLY_ERROR });
      expect(importPolicyPackDecisionSpy).not.toHaveBeenCalled();
    });
  });

  describe("Under standard REGULAR_TENANT", () => {
    beforeEach(() => {
      getAuthSessionSpy.mockResolvedValue({
        sessionId: "session-123",
        tenantId: REGULAR_TENANT,
        principalId: "p-123",
        subject: "user@example.com",
        requireMfa: false,
      });

      getWorkspaceContextSpy.mockResolvedValue({
        tenantId: REGULAR_TENANT,
        workspaceId: "w-123",
        workspaceSlug: "regular",
      });

      getRequiredWorkspaceContextSpy.mockResolvedValue({
        tenantId: REGULAR_TENANT,
        workspaceId: "w-123",
        workspaceSlug: "regular",
      });
    });

    it("allows workspace-actions -> createWorkspace", async () => {
      const formData = new FormData();
      formData.set("workspaceName", "New Workspace");
      const result = await createWorkspace(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result?.error).toBeUndefined();
    });

    it("allows branch-actions -> deleteBranchAdmin", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-123");
      formData.set("confirm", "DELETE");
      const result = await deleteBranchAdmin(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result).toEqual({ success: true });
    });

    it("allows policy-actions -> importPolicy", async () => {
      const formData = new FormData();
      formData.set("source", "rules:\n  - stableRuleId: r1");
      const result = await importPolicy(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
    });

    it("allows policy-actions -> createPolicyBranch", async () => {
      const formData = new FormData();
      formData.set("branchName", "new-policy");
      const result = await createPolicyBranch(null, formData);
      expect(result).toEqual({ branchId: "branch-123", revisionId: "revision-123" });
    });

    it("allows publish-actions -> rollbackBranch", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      const result = await rollbackBranch(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result?.error).toBeUndefined();
    });

    it("allows rule-actions -> createDraftRuleRevision", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("baseRevisionId", "rev-1");
      const result = await createDraftRuleRevision(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result?.error).toBeUndefined();
    });

    it("allows rule-actions -> commitRuleRevision", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("parentRevisionId", "rev-1");
      formData.set("rulesPayload", JSON.stringify([{ stableRuleId: "r1", title: "Rule 1", effect: "ALLOW" }]));
      const result = await commitRuleRevision(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result?.error).toBeUndefined();
    });

    it("allows remaining evidence, escalation, and pack actions", async () => {
      const formData = new FormData();
      formData.set("branchId", "b-1");
      formData.set("revisionId", "rev-1");
      formData.set("queueId", "q-1");
      formData.set("resolutionOutcome", "PROCEED");
      formData.set("decision", "ACCEPT");
      formData.set("packId", "pack-1");

      await expect(runSimulation(null, formData)).resolves.not.toEqual({ error: FRIENDLY_ERROR });
      await expect(generateSimulationChangeRecommendation(null, formData)).resolves.not.toEqual({ error: FRIENDLY_ERROR });
      await expect(applySimulationChangeRecommendation(null, formData)).resolves.not.toEqual({ error: FRIENDLY_ERROR });
      await expect(claimEscalation(null, formData)).resolves.not.toEqual({ error: FRIENDLY_ERROR });
      await expect(resolveEscalation(null, formData)).resolves.not.toEqual({ error: FRIENDLY_ERROR });
      await expect(importPolicyPack(null, formData)).resolves.not.toEqual({ error: FRIENDLY_ERROR });
    });

    it("uses active demo workspace context for demo persona switching even when the session tenant is regular", async () => {
      getWorkspaceContextSpy.mockResolvedValue({
        tenantId: DEMO_TENANT,
        workspaceId: "demo-workspace",
        workspaceSlug: "workspace-demo",
      });
      getAuthSessionSpy.mockResolvedValue({
        sessionId: "session-123",
        tenantId: REGULAR_TENANT,
        principalId: "regular-admin",
        subject: "user@example.com",
        requireMfa: false,
        mfaVerified: true,
      });

      const formData = new FormData();
      formData.set("actorId", "00000000-0000-0000-0000-000000000013");
      const result = await setActiveActor(null, formData);

      expect(result).toEqual({ actorId: "00000000-0000-0000-0000-000000000013" });
      expect(findActorByIdSpy).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000013", {
        tenantId: DEMO_TENANT,
        workspaceId: "demo-workspace",
      });
      expect(updateSessionForActorSwitchSpy).toHaveBeenCalledWith({
        sessionId: "session-123",
        tenantId: DEMO_TENANT,
        principalId: "00000000-0000-0000-0000-000000000013",
      });
    });
  });
});
