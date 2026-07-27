import { describe, expect, it } from "vitest";
import { buildSimulationRegressionSummary, buildSimulationRun } from "../src/schema";

describe("simulation regression summaries", () => {
  it("preserves the retained-log regression contract on a simulation run", () => {
    const run = buildSimulationRun({
      id: "sim-1",
      branchId: "branch-1",
      revisionId: "revision-1",
      sourceEventCount: 42,
      createdBy: "reviewer-1",
      createdAt: "2026-07-16T00:00:00.000Z",
      results: [],
      regressionSummary: {
        coverage: "RETAINED_LOG",
        newlyDeniedExpectedWorkCount: 2,
        removedEscalationCoverageCount: 1,
        newlyAllowedHighRiskCount: 0,
        blockingCount: 3,
      },
    });

    expect(run.regressionSummary).toEqual(expect.objectContaining({
      coverage: "RETAINED_LOG",
      blockingCount: 3,
    }));
  });

  it("separates expected-work, escalation, and known-high-risk regressions", () => {
    const summary = buildSimulationRegressionSummary({
      coverage: "RETAINED_LOG",
      highRiskEventIds: ["high-risk-1"],
      results: [
        { eventId: "expected-1", connector: "github", action: "deploy", previousStatus: "ALLOW", proposedStatus: "DENY", delta: "NEW_DENY", matchedPolicyRefs: [], reason: "changed" },
        { eventId: "escalation-1", connector: "stripe", action: "refund", previousStatus: "ESCALATE", proposedStatus: "ALLOW", delta: "MODIFIED", matchedPolicyRefs: [], reason: "changed" },
        { eventId: "high-risk-1", connector: "database", action: "delete", previousStatus: "DENY", proposedStatus: "ALLOW", delta: "NEW_ALLOW", matchedPolicyRefs: [], reason: "changed" },
      ],
    });

    expect(summary).toMatchObject({
      newlyDeniedExpectedWorkCount: 1,
      removedEscalationCoverageCount: 1,
      newlyAllowedHighRiskCount: 1,
      blockingCount: 3,
    });
  });
});
