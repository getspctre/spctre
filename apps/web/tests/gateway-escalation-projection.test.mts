import { beforeEach, describe, expect, it, vi } from "vitest";

// The queue projection is what crosses the network: GET /api/gateway/escalations
// serialises it, and the escalations page ships it as RSC props. Redaction
// therefore has to happen here, in the repository, not in the component that
// renders it — a client component can only change what is displayed, never what
// was already sent.
const sqlMock = vi.fn();

vi.mock("@/lib/db", () => ({ sql: Object.assign((...args: unknown[]) => sqlMock(...args), {}) }));
vi.mock("@spctre/platform/logging", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const escalations = await import("../lib/repositories/gateway/escalations");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function queueRow(toolParameters: unknown) {
  return {
    id: "q1",
    tenant_id: TENANT_ID,
    workspace_id: "w1",
    gateway_decision_id: "gd1",
    decision_id: "dec-1",
    revision_id: null,
    artifact_hash: "hash-1",
    status: "PENDING",
    assigned_to: null,
    sla_due_at: new Date(),
    handoff_notes: null,
    resolved_at: null,
    resolution_outcome: null,
    resolution_note: null,
    connector: "stripe",
    action: "refund.create",
    consequence: "HIGH",
    customer_tier: null,
    confidence: null,
    amount_usd: null,
    data_sensitivity: null,
    trust_score: null,
    context_budget: null,
    risk_level: "HIGH",
    gateway_reason: "manual review",
    agent_id: "agent-1",
    tool_intent: null,
    plan_summary: null,
    tool_parameters: toolParameters,
    safeguard_telemetry: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe("escalation queue review projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A query failure must not be spelled the same way as "nothing to review".
  // Both routes already answer 503 for a rejection; swallowing here is what
  // made a missing column render as "Queue is clear".
  it("propagates query failures instead of returning an empty queue", async () => {
    sqlMock.mockRejectedValue(new Error("column gd.connector does not exist"));

    await expect(escalations.listOpenEscalationQueue("w1", TENANT_ID)).rejects.toThrow(
      "column gd.connector does not exist",
    );
  });

  it("propagates status query failures instead of reporting no escalation", async () => {
    sqlMock.mockRejectedValue(new Error("connection terminated"));

    await expect(
      escalations.getEscalationStatusByDecisionId("dec-1", TENANT_ID, "w1"),
    ).rejects.toThrow("connection terminated");
  });

  it("redacts sensitive parameter keys before they leave the server", async () => {
    sqlMock.mockResolvedValue([queueRow({ apiKey: "sk-live-not-really-a-secret", amount: 4200 })]);

    const [item] = await escalations.listOpenEscalationQueue("w1", TENANT_ID);

    expect(item.toolParameters).toEqual({ apiKey: "[REDACTED]", amount: 4200 });
  });

  it("bounds deeply nested parameters", async () => {
    sqlMock.mockResolvedValue([
      queueRow({ a: { b: { c: { d: { e: { f: "too deep to serialise" } } } } } }),
    ]);

    const [item] = await escalations.listOpenEscalationQueue("w1", TENANT_ID);

    expect(JSON.stringify(item.toolParameters)).toContain("Truncated");
    expect(JSON.stringify(item.toolParameters)).not.toContain("too deep to serialise");
  });

  it("leaves non-object parameters absent rather than passing them through", async () => {
    sqlMock.mockResolvedValue([queueRow(["not", "an", "object"])]);

    const [item] = await escalations.listOpenEscalationQueue("w1", TENANT_ID);

    expect(item.toolParameters).toBeUndefined();
  });

  // The counterpart to the projection: the runtime handoff must stay canonical,
  // because the agent replays these to execute what the human approved. The
  // release rule (RESOLVED + PROCEED only) lives in the domain service.
  it("keeps the runtime status payload verbatim", async () => {
    const toolParameters = { apiKey: "sk-live-not-really-a-secret", amount: 4200 };
    sqlMock.mockResolvedValue([
      {
        decision_id: "dec-1",
        gateway_decision_id: "gd1",
        status: "RESOLVED",
        resolution_outcome: "PROCEED",
        resolution_note: null,
        agent_guidance: null,
        sla_due_at: null,
        resolved_at: new Date(),
        connector: "stripe",
        action: "refund.create",
        tool_parameters: toolParameters,
      },
    ]);

    const status = await escalations.getEscalationStatusByDecisionId("dec-1", TENANT_ID, "w1");

    expect(status?.toolParameters).toEqual(toolParameters);
  });
});
