import { describe, it, expect } from "vitest";
import { buildControlEvidenceRollup } from "../src/index";
import type { PolicyRuleSummary } from "../src/index";

const rules: PolicyRuleSummary[] = [
  {
    stableRuleId: "stripe.refund.high_value_review",
    title: "Escalate high-value refunds",
    effect: "ESCALATE",
    sourceFormat: "SPCTRE_MANAGED",
    domains: ["refunds"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false,
    controlMappings: [
      { framework: "SOC2", controlId: "CC6.1", rationale: "Reviews high-value refunds." },
    ],
  },
  {
    stableRuleId: "stripe.payout.destination_change.block",
    title: "Block payout destination changes",
    effect: "DENY",
    sourceFormat: "SPCTRE_MANAGED",
    domains: ["payouts"],
    connectors: ["stripe"],
    actions: ["payout.update_destination"],
    immutable: true,
    controlMappings: [
      { framework: "SOC2", controlId: "CC6.1", rationale: "Prevents fund redirection." },
    ],
  },
  {
    stableRuleId: "stripe.dispute.evidence_submission.warn",
    title: "Warn on dispute evidence submission",
    effect: "WARN",
    sourceFormat: "SPCTRE_MANAGED",
    domains: ["disputes"],
    connectors: ["stripe"],
    actions: ["dispute.submit_evidence"],
    immutable: false,
  },
];

describe("buildControlEvidenceRollup", () => {
  it("returns zero-count entries for controls with no matching evidence", () => {
    const rollup = buildControlEvidenceRollup({ rules, evidence: [] });
    expect(rollup).toHaveLength(1);
    expect(rollup[0]).toMatchObject({
      framework: "SOC2",
      controlId: "CC6.1",
      decisionCount: 0,
      deniedCount: 0,
      warnedCount: 0,
    });
    expect(rollup[0].stableRuleIds.sort()).toEqual([
      "stripe.payout.destination_change.block",
      "stripe.refund.high_value_review",
    ]);
  });

  it("folds evidence into per-control decision/deny/warn counts and tracks the latest timestamp", () => {
    const rollup = buildControlEvidenceRollup({
      rules,
      evidence: [
        {
          policyRefs: ["stripe.refund.high_value_review"],
          status: "ESCALATE",
          createdAt: "2026-07-01T00:00:00Z",
        },
        {
          policyRefs: ["stripe.payout.destination_change.block"],
          status: "DENY",
          createdAt: "2026-07-10T00:00:00Z",
        },
        {
          policyRefs: ["stripe.dispute.evidence_submission.warn"],
          status: "WARN",
          createdAt: "2026-07-15T00:00:00Z",
        },
      ],
    });
    expect(rollup).toHaveLength(1);
    const entry = rollup[0];
    expect(entry.decisionCount).toBe(2);
    expect(entry.deniedCount).toBe(1);
    expect(entry.warnedCount).toBe(0);
    expect(entry.latestEvidenceAt).toBe("2026-07-10T00:00:00Z");
  });

  it("does not crash on evidence with empty policyRefs", () => {
    const rollup = buildControlEvidenceRollup({
      rules,
      evidence: [{ policyRefs: [], status: "ALLOW", createdAt: "2026-07-01T00:00:00Z" }],
    });
    expect(rollup[0].decisionCount).toBe(0);
  });
});
