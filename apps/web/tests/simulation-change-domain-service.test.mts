import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSimulationRun } from "@spctre/policy-schema";

const getWorkspaceContextSpy = vi.fn();
const getActiveActorSpy = vi.fn();
const appendOperationsLogSpy = vi.fn(async () => undefined);
const getEvidenceSimulationRunSpy = vi.fn();

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: getWorkspaceContextSpy,
}));

vi.mock("@/lib/actors", () => ({
  getActiveActor: getActiveActorSpy,
}));

vi.mock("@/lib/repositories/operations-log", () => ({
  appendOperationsLog: appendOperationsLogSpy,
}));
vi.mock("@/lib/repositories/evidence", () => ({
  getEvidenceSimulationRun: getEvidenceSimulationRunSpy,
}));

const service = await import("../lib/domains/simulation-change/service");

describe("simulation change domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceContextSpy.mockResolvedValue({ workspaceId: "w1", tenantId: "t1" });
    getActiveActorSpy.mockResolvedValue({
      actor: { id: "maya-security", name: "Maya Security", reviewerRoles: ["Security"] },
      actors: [{ id: "maya-security", name: "Maya Security", reviewerRoles: ["Security"] }],
    });
    getEvidenceSimulationRunSpy.mockResolvedValue(buildSimulationRun({
      id: "sim-1",
      branchId: "br-prod-support",
      revisionId: "rev-8f12",
      sourceEventCount: 12,
      createdBy: "system:simulation-guidance-v1",
      createdAt: "2026-05-12T10:00:00.000Z",
      results: [
        {
          eventId: "decision-1",
          connector: "stripe",
          action: "stripe.refund.create",
          previousStatus: "ALLOW",
          proposedStatus: "DENY",
          delta: "NEW_DENY",
          matchedPolicyRefs: ["stripe.refund.manager_approval"],
          reason: "Refunds require manager approval.",
        },
        {
          eventId: "decision-2",
          connector: "stripe",
          action: "stripe.refund.update",
          previousStatus: "DENY",
          proposedStatus: "ALLOW",
          delta: "NEW_ALLOW",
          matchedPolicyRefs: ["stripe.refund.manager_approval"],
          reason: "Refund update no longer matched.",
        },
        {
          eventId: "decision-3",
          connector: "github",
          action: "github.repo.read",
          previousStatus: "ALLOW",
          proposedStatus: "ALLOW",
          delta: "UNCHANGED",
          matchedPolicyRefs: ["github.repo.read"],
          reason: "Unchanged.",
        },
      ],
    }));
    appendOperationsLogSpy.mockResolvedValue(undefined);
  });

  it("generates and audits a simulation-guided recommendation", async () => {
    const result = await service.generateSimulationChangeRecommendation({
      branchId: "br-prod-support",
      revisionId: "rev-8f12",
    }, { tenantId: "t1", workspaceId: "w1" });

    expect(result).toMatchObject({
      ok: true,
      recommendation: {
        sourceId: "system:simulation-guidance-v1",
        category: "SIMULATION_GUIDED_CHANGE",
        branchId: "br-prod-support",
        revisionId: "rev-8f12",
        runId: "sim-1",
        newlyDeniedCount: 1,
        newlyAllowedCount: 1,
      },
    });
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "SIMULATION_GUIDANCE",
      actorId: "system:simulation-guidance-v1",
      sourceId: "sim-1",
      sourceTable: "simulation_run",
      payload: expect.objectContaining({
        action: "RECOMMENDED",
        generatedForActorId: "maya-security",
        recommendation: expect.objectContaining({
          category: "SIMULATION_GUIDED_CHANGE",
          sampledEventIds: ["decision-1", "decision-2", "decision-3"],
        }),
      }),
    }));
  });

  it("requires rationale before recording reviewer disposition", async () => {
    const result = await service.applySimulationChangeDecision({
      decision: "ACCEPT",
      branchId: "br-prod-support",
      revisionId: "rev-8f12",
      recommendationId: "simulation-change-1",
    }, { tenantId: "t1", workspaceId: "w1" });

    expect(result).toEqual({ error: "Reviewer rationale is required for recommendation decisions." });
    expect(appendOperationsLogSpy).not.toHaveBeenCalled();
  });

  it("records reviewer dispositions without creating a policy write", async () => {
    const result = await service.applySimulationChangeDecision({
      decision: "EDIT",
      rationale: "Limit this to the production refund scope before authoring a revision.",
      recommendationId: "simulation-change-1",
      branchId: "br-prod-support",
      revisionId: "rev-8f12",
      runId: "sim-1",
      recommendationSummary: "Review refund approval.",
      editedSummary: "Review production refund approval.",
    }, { tenantId: "t1", workspaceId: "w1" });

    expect(result).toEqual({ ok: true });
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "SIMULATION_GUIDANCE",
      actorId: "maya-security",
      sourceId: "sim-1",
      sourceTable: "simulation_run",
      payload: expect.objectContaining({
        action: "EDIT",
        sourceId: "system:simulation-guidance-v1",
        category: "SIMULATION_GUIDED_CHANGE",
        policyWriteCreated: false,
        rationale: "Limit this to the production refund scope before authoring a revision.",
      }),
    }));
  });
});
