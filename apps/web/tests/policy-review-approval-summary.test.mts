import { describe, expect, it } from "vitest";
import { getPolicyApprovalRoleSummary } from "../app/review/approval-panel";

describe("getPolicyApprovalRoleSummary", () => {
  it("separates the active reviewer's decision from the role's approval count", () => {
    const summary = getPolicyApprovalRoleSummary({
      role: "Security",
      actorId: "reviewer-2",
      approvals: [
        { reviewer: "reviewer-1", role: "Security", status: "APPROVED", reviewedAt: "2026-08-01T00:00:00.000Z" },
        { reviewer: "reviewer-2", role: "Security", status: "PENDING", reviewedAt: "2026-08-02T00:00:00.000Z" },
      ],
    });

    expect(summary.approvedCount).toBe(1);
    expect(summary.actorApproval).toMatchObject({ reviewer: "reviewer-2", status: "PENDING" });
  });
});
