import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSimulationRun } from "@spctre/policy-schema";

const getWorkspaceContextSpy = vi.fn();
const getActiveActorSpy = vi.fn();
const appendOperationsLogSpy = vi.fn(async () => undefined);
const getEvidenceSimulationRunSpy = vi.fn();
const persistSimulationRunSpy = vi.fn(async () => "11111111-1111-4111-8111-111111111111");

vi.mock("@/lib/workspace", () => ({ getWorkspaceContext: getWorkspaceContextSpy }));

vi.mock("@/lib/actors", () => ({ getActiveActor: getActiveActorSpy }));

vi.mock("@/lib/repositories/operations-log", () => ({
  appendOperationsLog: appendOperationsLogSpy,
}));
vi.mock("@/lib/repositories/evidence", () => ({
  getEvidenceSimulationRun: getEvidenceSimulationRunSpy,
  persistSimulationRun: persistSimulationRunSpy,
}));

vi.mock("@spctre/platform", () => ({
  recordDuration: vi.fn(),
  withSpan: async (
    _name: string,
    _attributes: Record<string, unknown>,
    callback: (span: {
      setAttributes: (attrs: Record<string, unknown>) => void;
    }) => Promise<unknown>,
  ) => callback({ setAttributes: vi.fn() }),
}));

const service = await import("../lib/domains/evidence/service");

// Who is running the simulation and where. Supplied by the caller now: the
// console reads it from the session, the API route from the token.
const SIMULATION_CONTEXT = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  workspaceId: "w1",
  actorId: "maya-security",
};

describe("evidence simulation domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceContextSpy.mockResolvedValue({ workspaceId: "w1", tenantId: "t1" });
    getActiveActorSpy.mockResolvedValue({ actor: { id: "maya-security", name: "Maya Security" } });
    getEvidenceSimulationRunSpy.mockResolvedValue(
      buildSimulationRun({
        id: "sim-1",
        branchId: "br-prod-support",
        revisionId: "rev-8f12",
        sourceEventCount: 2,
        createdBy: "maya-security",
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
            connector: "github",
            action: "github.repo.read",
            previousStatus: "ALLOW",
            proposedStatus: "ALLOW",
            delta: "UNCHANGED",
            matchedPolicyRefs: ["github.repo.read"],
            reason: "Unchanged.",
          },
        ],
      }),
    );
  });

  it("persists and audits simulation runs", async () => {
    const result = await service.runSimulationDecision(
      { branchId: "br-prod-support", revisionId: "rev-8f12" },
      SIMULATION_CONTEXT,
    );

    expect(result).toMatchObject({
      newlyDenied: 1,
      newlyAllowed: 0,
      unchanged: 1,
      total: 2,
      branchId: "br-prod-support",
      revisionId: "rev-8f12",
      runId: "11111111-1111-4111-8111-111111111111",
    });
    expect(persistSimulationRunSpy).toHaveBeenCalled();
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SIMULATION_RUN",
        actorId: "maya-security",
        sourceId: "11111111-1111-4111-8111-111111111111",
        sourceTable: "simulation_run",
        payload: expect.objectContaining({
          branchId: "br-prod-support",
          revisionId: "rev-8f12",
          sourceEventCount: 2,
          newlyDeniedCount: 1,
          sampledEventIds: ["decision-1", "decision-2"],
        }),
      }),
    );
  });

  it("binds the tenant the caller named rather than resolving one", async () => {
    // The domain used to read the session for its workspace, which is why no
    // bearer caller could reach it. The context is now an argument, so the run
    // is attributed to the principal the caller names.
    const result = await service.runSimulationDecision(
      { branchId: "br-prod-support", revisionId: "rev-8f12" },
      { ...SIMULATION_CONTEXT, actorId: "principal-from-token" },
    );

    expect(result).not.toHaveProperty("error");
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "principal-from-token" }),
    );
  });
});
