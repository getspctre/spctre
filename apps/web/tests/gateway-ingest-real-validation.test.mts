import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ingestGatewayEvent: vi.fn(),
  incrementCounter: vi.fn(),
  resolveWebhookRegistrationBySecret: vi.fn(),
  warn: vi.fn(),
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
vi.mock("@spctre/platform/logging", () => ({ logger: { warn: state.warn } }));
vi.mock("@spctre/platform/tracing", () => ({
  withSpan: async (_name: string, _attributes: unknown, fn: () => unknown) => fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { normalizePortkeyEvent, validateGatewayEvent } =
  await import("../lib/domains/gateway/ingest");
const { handleRegisteredGatewayIngest } = await import("../app/api/gateway-ingest/_shared");
const { POST: mcpPost } = await import("../app/api/gateway-ingest/mcp/route");

describe("gateway ingest real validation boundary", () => {
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

  it("uses the real normalizer and schema validation error class for a structured 422", async () => {
    const response = await handleRegisteredGatewayIngest({
      request: new Request("https://app.example/api/gateway-ingest/portkey", {
        method: "POST",
        headers: { "x-portkey-webhook-secret": "secret", "x-request-id": "trace-real" },
        body: JSON.stringify({ id: "event-real" }),
      }),
      provider: "portkey",
      providerHeader: "x-portkey-webhook-secret",
      route: "/api/gateway-ingest/portkey",
      spanName: "test.gateway-ingest.real",
      defaultPrincipalId: "gateway:portkey",
      invalidPayloadMessage: "Invalid Portkey payload.",
      normalize: (raw) => {
        const normalized = normalizePortkeyEvent(raw);
        return validateGatewayEvent({ ...normalized, latencyMs: -1 });
      },
      getEnvironment: () => "production",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid normalized gateway event.",
      issues: [{ path: "latencyMs", message: "Too small: expected number to be >=0" }],
      meta: expect.objectContaining({ traceId: "trace-real" }),
    });
  });

  it("rounds fractional MCP latency with the shared producer normalizer", async () => {
    const response = await postMcpEvent(187.5);

    expect(response.status).toBe(201);
    expect(state.ingestGatewayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ latencyMs: 188 }) }),
    );
  });

  it.each([
    { latencyMs: -10_000, expected: 0 },
    { latencyMs: Number.MAX_SAFE_INTEGER + 1, expected: Number.MAX_SAFE_INTEGER },
  ])("clamps anomalous MCP latency $latencyMs with telemetry", async ({ latencyMs, expected }) => {
    const response = await postMcpEvent(latencyMs);

    expect(response.status).toBe(201);
    expect(state.ingestGatewayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ latencyMs: expected }) }),
    );
    expect(state.warn).toHaveBeenCalledWith(
      "Gateway event numeric field normalized",
      expect.objectContaining({
        provider: "portkey",
        field: "latencyMs",
        normalized: expected,
        reason: "clamped",
      }),
    );
    expect(state.incrementCounter).toHaveBeenCalledWith("spctre.gateway.event.normalized", 1, {
      provider: "portkey",
      field: "latencyMs",
      reason: "clamped",
    });
  });
});

function postMcpEvent(latencyMs: number): Promise<Response> {
  return mcpPost(
    new Request("https://app.example/api/gateway-ingest/mcp", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({
        provider: "portkey",
        gateway_event_id: "event-mcp-real",
        agent_id: "agent-1",
        latency_ms: latencyMs,
      }),
    }),
  );
}
