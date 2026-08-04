import { describe, expect, it } from "vitest";
import { evaluateExampleDecision } from "../app/review/rule-actions";

// Exercises the executable-example-inputs preview: the draft payload is run
// through the same evaluateDecision the gateway uses, so the preview reflects
// real enforcement (including typed parameter constraints).
const REFUND_RULE = JSON.stringify([
  {
    stableRuleId: "stripe.refund.high_value_review",
    title: "Escalate high-value refunds",
    effect: "ESCALATE",
    sourceFormat: "AGT_YAML",
    domains: ["refunds"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false,
    parameterConstraints: [{ field: "amount_cents", operator: "gte", value: 50000 }],
  },
]);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("evaluateExampleDecision", () => {
  it("escalates when a parameter constraint matches", async () => {
    const state = await evaluateExampleDecision(
      null,
      form({
        rulesPayload: REFUND_RULE,
        connector: "stripe",
        action: "refund.create",
        toolParameters: '{ "amount_cents": 60000 }',
      }),
    );
    expect(state && "result" in state).toBe(true);
    if (!state || !("result" in state)) return;
    expect(state.result.status).toBe("ESCALATE");
    expect(state.result.matchedRefs).toContain("stripe.refund.high_value_review");
  });

  it("allows when the parameter constraint does not match", async () => {
    const state = await evaluateExampleDecision(
      null,
      form({
        rulesPayload: REFUND_RULE,
        connector: "stripe",
        action: "refund.create",
        toolParameters: '{ "amount_cents": 4000 }',
      }),
    );
    expect(state && "result" in state).toBe(true);
    if (!state || !("result" in state)) return;
    expect(state.result.status).toBe("ALLOW");
    expect(state.result.matchedRefs).toEqual([]);
  });

  it("requires a connector and action", async () => {
    const state = await evaluateExampleDecision(
      null,
      form({ rulesPayload: REFUND_RULE, connector: "stripe" }),
    );
    expect(state).toEqual({ error: expect.stringContaining("connector and an action") });
  });

  it("rejects malformed tool parameters", async () => {
    const state = await evaluateExampleDecision(
      null,
      form({
        rulesPayload: REFUND_RULE,
        connector: "stripe",
        action: "refund.create",
        toolParameters: "{ not json",
      }),
    );
    expect(state).toEqual({ error: expect.stringContaining("valid JSON") });
  });
});
