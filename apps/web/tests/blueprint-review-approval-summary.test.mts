import { describe, expect, it } from "vitest";
import { getBlueprintApprovalRoleSummary } from "../app/blueprints/[id]/blueprint-review-actions";

describe("getBlueprintApprovalRoleSummary", () => {
  it("keeps the active reviewer's decision separate from the role's aggregate approval count", () => {
    const summary = getBlueprintApprovalRoleSummary({
      role: "Security",
      actorId: "reviewer-2",
      requiredCount: 2,
      approvals: [
        { reviewer: "reviewer-1", role: "Security", status: "APPROVED", reviewedAt: "2026-08-01T00:00:00.000Z" },
        { reviewer: "reviewer-2", role: "Security", status: "PENDING", reviewedAt: "2026-08-02T00:00:00.000Z" },
      ],
    });

    expect(summary.approvedCount).toBe(1);
    expect(summary.requiredCount).toBe(2);
    expect(summary.actorApproval).toMatchObject({ reviewer: "reviewer-2", status: "PENDING" });
  });
});
