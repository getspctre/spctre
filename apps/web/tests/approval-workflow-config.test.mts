import { describe, expect, it } from "vitest";
import { evaluatePublishReadiness } from "@spctre/policy-schema";
import {
  approvalRulesFromWorkflow,
  defaultApprovalWorkflowSnapshot,
} from "../lib/repositories/approval-workflow";

describe("approval workflow configuration", () => {
  it("preserves the existing default Security and Platform gate", () => {
    const workflow = defaultApprovalWorkflowSnapshot({ workspaceId: "ws-1", environment: "production" });
    expect(workflow).toMatchObject({
      name: "Default approval workflow",
      reviewMode: "PARALLEL",
      workspaceId: "ws-1",
      environment: "production",
    });
    expect(approvalRulesFromWorkflow(workflow)).toEqual([
      { role: "Security", requiredCount: 1 },
      { role: "Platform", requiredCount: 1 },
    ]);
  });

  it("uses an eligible reviewer role for an unconfigured workspace", () => {
    const workflow = defaultApprovalWorkflowSnapshot({ workspaceId: "ws-1", eligibleReviewerRole: "Security" });

    expect(workflow.name).toBe("Default reviewer workflow");
    expect(approvalRulesFromWorkflow(workflow)).toEqual([
      { role: "Security", requiredCount: 1 },
    ]);
  });

  it("attaches the workflow snapshot to publish readiness and blocks missing configured roles", () => {
    const workflow = {
      ...defaultApprovalWorkflowSnapshot(),
      id: "wf-1",
      name: "Sequential production gate",
      reviewMode: "SEQUENTIAL" as const,
      rules: [
        { role: "Legal", requiredCount: 1, eligibleRoles: ["Legal"], sequence: 1 },
        { role: "Security", requiredCount: 2, eligibleRoles: ["Security", "Admin"], sequence: 2 },
      ],
    };

    const readiness = evaluatePublishReadiness({
      branchId: "branch-1",
      revisionId: "rev-1",
      approvalRules: approvalRulesFromWorkflow(workflow),
      approvals: [{ reviewer: "sec-1", role: "Security", status: "APPROVED", reviewedAt: "2026-05-13T00:00:00Z" }],
      approvalWorkflow: workflow,
    });

    expect(readiness.status).toBe("PENDING");
    expect(readiness.approvalWorkflow?.name).toBe("Sequential production gate");
    expect(readiness.missingRoles).toEqual(["Legal", "Security"]);
  });
});
