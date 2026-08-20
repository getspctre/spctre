import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ingestGatewayEvent: vi.fn(),
  incrementCounter: vi.fn(),
  resolveWebhookRegistrationBySecret: vi.fn(),
}));

vi.mock("@/lib/platform/config", () => ({
  evidenceIngestUrl: () => "",
  workerInternalSecret: () => "",
}));
vi.mock("@/lib/domains/gateway/service", () => ({
  getTenantIdOrDemo: () => "tenant-1",
  getWorkspaceIdOrDemo: () => "workspace-1",
  ingestGatewayEvent: state.ingestGatewayEvent,
  isGatewayDatabaseConfigured: () => true,
}));
vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi.fn(async () => ({
    ok: true,
    auth: { tenantId: "tenant-1", workspaceId: "workspace-1", principalId: "gateway:mcp" },
  })),
  hasBearerToken: () => true,
}));
vi.mock("@/lib/repositories/gateway-webhook", () => ({
  resolveWebhookRegistrationBySecret: state.resolveWebhookRegistrationBySecret,
}));
vi.mock("@spctre/platform/metrics", () => ({ incrementCounter: state.incrementCounter }));
vi.mock("@spctre/platform/tracing", () => ({
  withSpan: async (_name: string, _attributes: unknown, fn: () => unknown) => fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

class TestGatewayEventValidationError extends Error {
  readonly code = "INVALID_GATEWAY_EVENT";

  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super("Normalized gateway event failed spctre.gateway.event.v1 validation.");
  }
}

vi.mock("@/lib/domains/gateway/ingest", () => ({
  GatewayEventValidationError: TestGatewayEventValidationError,
  normalizeGatewayInteger: (value: number | undefined) =>
    Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value ?? 0))),
  normalizeGatewayCost: (value: number | undefined) =>
    value === undefined ? undefined : Math.max(0, value),
}));

const { handleRegisteredGatewayIngest } = await import("../app/api/gateway-ingest/_shared");
const { POST: mcpPost } = await import("../app/api/gateway-ingest/mcp/route");

describe("gateway ingest validation boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.resolveWebhookRegistrationBySecret.mockResolvedValue({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      provider: "portkey",
      registrationId: "registration-1",
    });
    state.ingestGatewayEvent.mockResolvedValue({
      decisionId: "gw-1",
      provenanceGap: false,
      deduplicated: false,
    });
  });

  it("returns a traceable structured 422 when webhook normalization fails validation", async () => {
    const response = await handleRegisteredGatewayIngest({
      request: new Request("https://app.example/api/gateway-ingest/portkey", {
        method: "POST",
        headers: { "x-portkey-webhook-secret": "secret", "x-request-id": "trace-123" },
        body: JSON.stringify({ id: "event-1" }),
      }),
      provider: "portkey",
      providerHeader: "x-portkey-webhook-secret",
      route: "/api/gateway-ingest/portkey",
      spanName: "test.gateway-ingest.portkey",
      defaultPrincipalId: "gateway:portkey",
      invalidPayloadMessage: "Invalid Portkey payload.",
      normalize: () => {
        throw new TestGatewayEventValidationError([
          { path: "latencyMs", message: "Too small: expected >=0" },
        ]);
      },
      getEnvironment: () => "production",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid normalized gateway event.",
      issues: [{ path: "latencyMs", message: "Too small: expected >=0" }],
      meta: expect.objectContaining({ traceId: "trace-123" }),
    });
    expect(state.incrementCounter).toHaveBeenCalledWith("spctre.api.errors", 1, {
      "http.route": "/api/gateway-ingest/portkey",
      "http.response.status_code": 422,
    });
  });

  it("drops empty MCP tool names before ingestion", async () => {
    const response = await mcpPost(
      new Request("https://app.example/api/gateway-ingest/mcp", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({
          provider: "portkey",
          gateway_event_id: "event-1",
          agent_id: "agent-1",
          tool_declarations: ["", "  ", "github_issue_create"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(state.ingestGatewayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ toolDeclarations: ["github_issue_create"] }),
      }),
    );
  });

  it("rounds fractional MCP latency instead of rejecting the event", async () => {
    const response = await mcpPost(
      new Request("https://app.example/api/gateway-ingest/mcp", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({
          provider: "portkey",
          gateway_event_id: "event-latency",
          agent_id: "agent-1",
          latency_ms: 187.5,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(state.ingestGatewayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ latencyMs: 188 }) }),
    );
  });

  it("returns a 422 rather than a 500 for MCP validation errors", async () => {
    state.ingestGatewayEvent.mockRejectedValueOnce(
      new TestGatewayEventValidationError([{ path: "latencyMs", message: "Invalid input" }]),
    );

    const response = await mcpPost(
      new Request("https://app.example/api/gateway-ingest/mcp", {
        method: "POST",
        headers: { authorization: "Bearer token", "x-request-id": "trace-mcp" },
        body: JSON.stringify({
          provider: "portkey",
          gateway_event_id: "event-1",
          agent_id: "agent-1",
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid normalized gateway event.",
      issues: [{ path: "latencyMs", message: "Invalid input" }],
      meta: expect.objectContaining({ traceId: "trace-mcp" }),
    });
  });
});
