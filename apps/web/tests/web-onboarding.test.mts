import { describe, expect, it } from "vitest";
import {
  STARTER_POLICY_RULES,
  WEB_ONBOARDING_MILESTONES,
  WEB_ONBOARDING_TOKEN_SCOPES,
} from "../lib/repositories/onboarding/shared";

describe("web onboarding contract", () => {
  it("publishes the sample DENY rule with the starter policy", () => {
    expect(STARTER_POLICY_RULES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stableRuleId: "sample.payment.block",
          effect: "DENY",
          connectors: ["sample"],
          actions: ["payment.create"],
          domains: ["finance"],
        }),
      ])
    );
  });

  it("issues setup tokens with the scopes needed for first connection", () => {
    expect(WEB_ONBOARDING_TOKEN_SCOPES).toEqual([
      "bundle:read",
      "decision:evaluate",
      "evidence:write",
      "heartbeat:write",
    ]);
  });

  it("tracks explicit milestones for sample, gateway handoff, and completion", () => {
    expect(WEB_ONBOARDING_MILESTONES).toEqual([
      "starter_policy_published",
      "sample_decision_sent",
      "setup_token_generated",
      "gateway_test_sent",
      "first_real_evidence_received",
      "onboarding_completed",
    ]);
  });
});
