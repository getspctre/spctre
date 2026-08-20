import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GATEWAY_EVENT_V1_SCHEMA_ID, GatewayEventV1Schema } from "../src/schemas/gateway-event.js";

const validGatewayEvent = {
  provider: "portkey",
  gatewayEventId: "evt-123",
  model: "gpt-4o",
  agentId: "agent-1",
  connector: "github",
  action: "github_issue_create",
  toolDeclarations: ["github_issue_create"],
  promptTokens: 120,
  completionTokens: 24,
  latencyMs: 188,
  costUsd: 0.0024,
  eventTimestamp: "2026-08-20T12:00:00.000Z",
  rawEvent: { id: "evt-123" },
};

describe("GatewayEventV1Schema", () => {
  // Keep this list synchronized with the Go mirror test until emitted schema
  // artifacts make a cross-language single-source assertion possible.
  const fieldNames = [
    "provider",
    "gatewayEventId",
    "model",
    "agentId",
    "connector",
    "action",
    "toolDeclarations",
    "promptTokens",
    "completionTokens",
    "latencyMs",
    "costUsd",
    "eventTimestamp",
    "rawEvent",
  ];

  it("has the canonical 13-field shape", () => {
    expect(Object.keys(GatewayEventV1Schema.shape).sort()).toEqual(fieldNames.sort());
  });

  it("accepts a valid normalized gateway event", () => {
    expect(GatewayEventV1Schema.safeParse(validGatewayEvent).success).toBe(true);
  });

  it("accepts an omitted optional costUsd", () => {
    const { costUsd: _costUsd, ...withoutCost } = validGatewayEvent;
    expect(GatewayEventV1Schema.safeParse(withoutCost).success).toBe(true);
  });

  it("rejects null costUsd", () => {
    expect(GatewayEventV1Schema.safeParse({ ...validGatewayEvent, costUsd: null }).success).toBe(
      false,
    );
  });

  it("rejects an unknown provider", () => {
    expect(
      GatewayEventV1Schema.safeParse({ ...validGatewayEvent, provider: "unknown" }).success,
    ).toBe(false);
  });

  it.each([
    "provider",
    "gatewayEventId",
    "model",
    "agentId",
    "connector",
    "action",
    "toolDeclarations",
    "promptTokens",
    "completionTokens",
    "latencyMs",
    "eventTimestamp",
    "rawEvent",
  ])("rejects a missing required field: %s", (field) => {
    const payload = { ...validGatewayEvent } as Record<string, unknown>;
    delete payload[field];

    expect(GatewayEventV1Schema.safeParse(payload).success).toBe(false);
  });

  it("rejects a field with the wrong type", () => {
    expect(
      GatewayEventV1Schema.safeParse({ ...validGatewayEvent, promptTokens: "120" }).success,
    ).toBe(false);
  });

  it("renders to JSON Schema without loss", () => {
    const rendered = z.toJSONSchema(GatewayEventV1Schema);
    const registry = z.toJSONSchema(z.globalRegistry);

    expect(z.globalRegistry.get(GatewayEventV1Schema)?.id).toBe(GATEWAY_EVENT_V1_SCHEMA_ID);
    expect(registry.schemas[GATEWAY_EVENT_V1_SCHEMA_ID]).toEqual(rendered);
    expect(rendered.type).toBe("object");
    expect(rendered.required).toEqual([
      "provider",
      "gatewayEventId",
      "model",
      "agentId",
      "connector",
      "action",
      "toolDeclarations",
      "promptTokens",
      "completionTokens",
      "latencyMs",
      "eventTimestamp",
      "rawEvent",
    ]);
    expect(rendered.properties?.latencyMs).toMatchObject({ minimum: 0, type: "integer" });
    expect(rendered.properties?.costUsd).toMatchObject({ minimum: 0 });
  });
});
