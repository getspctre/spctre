import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceContextSpy = vi.fn();
const getActiveActorSpy = vi.fn();
const getOpenEscalationQueueItemSpy = vi.fn();
const appendOperationsLogSpy = vi.fn(async () => undefined);

const isDatabaseConfiguredSpy = vi.fn();
const ensureAuthDemoTenantSpy = vi.fn();
const resolveTenantIdOrDemoSpy = vi.fn();
const resolveWorkspaceIdOrDemoSpy = vi.fn();
const resolveRevisionAtTimeSpy = vi.fn();
const insertGatewayEvidenceEventSpy = vi.fn();

vi.mock("@/lib/workspace/scope", () => ({ getActiveScope: getWorkspaceContextSpy }));

vi.mock("@/lib/actors", () => ({ getActiveActor: getActiveActorSpy }));

vi.mock("@/lib/repositories/gateway", () => ({
  resolveEscalationQueueItem: vi.fn(async () => true),
  assignEscalationQueueItem: vi.fn(async () => true),
  getOpenEscalationQueueItem: getOpenEscalationQueueItemSpy,
  resolveRevisionAtTime: resolveRevisionAtTimeSpy,
}));
vi.mock("@/lib/repositories/operations-log", () => ({
  appendOperationsLog: appendOperationsLogSpy,
}));
vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: isDatabaseConfiguredSpy,
}));
vi.mock("@/lib/repositories/auth/session", () => ({
  ensureAuthDemoTenant: ensureAuthDemoTenantSpy,
  resolveTenantIdOrDemo: resolveTenantIdOrDemoSpy,
  resolveWorkspaceIdOrDemo: resolveWorkspaceIdOrDemoSpy,
}));
vi.mock("@/lib/repositories/evidence", () => ({
  insertGatewayEvidenceEvent: insertGatewayEvidenceEventSpy,
}));

const gatewayService = await import("../lib/domains/gateway/service");

describe("gateway domain service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceContextSpy.mockResolvedValue({
      workspaceId: "w1",
      tenantId: "11111111-1111-4111-8111-111111111111",
    });
    getActiveActorSpy.mockResolvedValue({
      actor: { id: "maya-security", name: "Maya Security", reviewerRoles: ["Security"] },
      actors: [
        { id: "maya-security", name: "Maya Security", reviewerRoles: ["Security", "Legal"] },
        { id: "lee-platform", name: "Lee Platform", reviewerRoles: ["Platform", "Ops"] },
      ],
    });
    getOpenEscalationQueueItemSpy.mockResolvedValue({
      id: "q1",
      tenantId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "w1",
      gatewayDecisionId: "gd1",
      decisionId: "dec-high",
      artifactHash: "hash",
      status: "PENDING",
      slaDueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      connector: "github",
      action: "deployment.create",
      consequence: "HIGH",
      dataSensitivity: "LOW",
      riskLevel: "HIGH",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    appendOperationsLogSpy.mockResolvedValue(undefined);
  });

  it("validates escalation outcome input", async () => {
    const result = await gatewayService.resolveEscalationDecision(
      { queueId: "q1", resolutionOutcome: "INVALID" },
      { tenantId: "11111111-1111-4111-8111-111111111111", workspaceId: "w1" },
    );

    expect(result).toEqual({ error: "Resolution outcome must be PROCEED, ESCALATE, or ABORT." });
  });

  it("verifies if gateway database is configured", () => {
    isDatabaseConfiguredSpy.mockReturnValue(true);
    expect(gatewayService.isGatewayDatabaseConfigured()).toBe(true);
    expect(isDatabaseConfiguredSpy).toHaveBeenCalled();
  });

  it("returns resolved tenant and workspace IDs", () => {
    resolveTenantIdOrDemoSpy.mockReturnValue("resolved-tenant");
    resolveWorkspaceIdOrDemoSpy.mockReturnValue("resolved-workspace");

    expect(gatewayService.getTenantIdOrDemo("header-val")).toBe("resolved-tenant");
    expect(gatewayService.getWorkspaceIdOrDemo("header-val")).toBe("resolved-workspace");
  });

  it("returns the evidence repository ingestion result", async () => {
    resolveRevisionAtTimeSpy.mockResolvedValue(null);
    insertGatewayEvidenceEventSpy.mockResolvedValue({
      deduplicated: false,
      decisionId: "gw-dec-1",
      provenanceGap: true,
    });

    const event = {
      provider: "helicone" as const,
      gatewayEventId: "evt-123",
      model: "gpt-4o",
      agentId: "agent-1",
      connector: "llm-gateway",
      action: "llm_call",
      toolDeclarations: [],
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 120,
      costUsd: 0.002,
      eventTimestamp: new Date().toISOString(),
      rawEvent: { some: "data" },
    };

    const result = await gatewayService.ingestGatewayEvent({
      event,
      tenantId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "w1",
      principalId: "gateway:helicone",
      environment: "production",
    });

    expect(result).toMatchObject({ deduplicated: false });
  });
});
