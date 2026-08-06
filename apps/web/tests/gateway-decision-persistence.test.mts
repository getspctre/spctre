import { beforeEach, describe, expect, it, vi } from "vitest";

const persistGatewayDecisionSpy = vi.fn();
const findCredentialBrokerSpy = vi.fn();

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: <T,>(_tenantId: string, fn: () => T) => fn(),
}));

vi.mock("@/lib/repositories/gateway", () => ({
  persistGatewayDecision: persistGatewayDecisionSpy,
  findCredentialBroker: findCredentialBrokerSpy,
  brokerCredential: vi.fn(),
  updateGatewayDecisionOutcome: vi.fn(),
  assignEscalationQueueItem: vi.fn(),
  getEscalationStatusByDecisionId: vi.fn(),
  getOpenEscalationQueueItem: vi.fn(),
  getResolvedEscalationReceiptContext: vi.fn(),
  hasCredentialGrantBeenIssued: vi.fn(),
  hasCredentialGrantBeenIssuedByDecisionId: vi.fn(),
  resolveEscalationQueueItem: vi.fn(),
  listOpenEscalationQueue: vi.fn(),
  updateEscalationOutcome: vi.fn(),
}));
vi.mock("@/lib/repositories/operations-log", () => ({ appendOperationsLog: vi.fn() }));
vi.mock("@/lib/repositories/action-receipts", () => ({ persistActionReceipt: vi.fn() }));
vi.mock("@/lib/repositories/shared/database", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/actors", () => ({ getActiveActor: vi.fn() }));

const gatewayService = await import("../lib/domains/gateway/service");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function decideParams(
  input: Partial<
    Parameters<typeof gatewayService.persistGatewayDecisionAndBrokerCredentials>[0]["input"]
  > = {},
) {
  return {
    input: {
      decisionId: "dec-1",
      artifactHash: "hash-1",
      policyContext: [],
      connector: "stripe",
      action: "refund.create",
      ...input,
    },
    decisionResult: {
      outcome: "PROCEED" as const,
      reason: "within policy",
      riskLevel: "LOW" as const,
      shouldQueue: false,
    },
    tenantId: TENANT_ID,
    workspaceId: "w1",
    actorId: "maya-security",
  } as Parameters<typeof gatewayService.persistGatewayDecisionAndBrokerCredentials>[0];
}

describe("gateway decision persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistGatewayDecisionSpy.mockResolvedValue("gd1");
    findCredentialBrokerSpy.mockResolvedValue(null);
  });

  it("persists the connector and action on the decision itself", async () => {
    await gatewayService.persistGatewayDecisionAndBrokerCredentials(decideParams());

    expect(persistGatewayDecisionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ connector: "stripe", action: "refund.create" }),
    );
  });

  // Scope: this pins the *service* layer only — it must not add a redaction
  // pass of its own, because gateway_decision.tool_parameters is what
  // approvedToolParameters reports back, and each extra pass widens the gap
  // between what the reviewer saw and what the agent can confirm against.
  // It does NOT establish end-to-end fidelity, and is not meant to: the input
  // reaching this function has already been through GatewayDecisionSchema,
  // whose toolParameters transform redacts and bounds at the API boundary
  // (mirrored in the Go worker's sanitizeGatewayDecisionRequest). That loss is
  // by design — approvedToolParameters is a confirmation of the reviewed
  // arguments, not a replay payload.
  it("does not redact tool parameters again on the write path", async () => {
    const toolParameters = {
      apiKey: "sk-live-not-really-a-secret",
      amount: 4200,
      metadata: { ticket: { thread: { message: { id: "TSK-992" } } } },
    };

    await gatewayService.persistGatewayDecisionAndBrokerCredentials(
      decideParams({ toolParameters }),
    );

    expect(persistGatewayDecisionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ toolParameters }),
    );
    const [{ toolParameters: persisted }] = persistGatewayDecisionSpy.mock.calls[0];
    expect(JSON.stringify(persisted)).not.toContain("REDACTED");
    expect(JSON.stringify(persisted)).not.toContain("Truncated");
  });
});
