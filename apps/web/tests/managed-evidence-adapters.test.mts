import { describe, expect, it } from "vitest";
import { normalizeManagedProviderEvent } from "../lib/domains/evidence/managed-adapters";

describe("managed evidence adapters", () => {
  it("preserves AgentCore request and agent identity", () => {
    expect(
      normalizeManagedProviderEvent("bedrock_agentcore", {
        "aws.agent.id": "agent-1",
        "aws.request_id": "req-1",
        "aws.operation.name": "InvokeAgentRuntime",
      }),
    ).toMatchObject({
      source_event_id: "req-1",
      action: "InvokeAgentRuntime",
      agent: { id: "agent-1" },
    });
  });
  it("maps LangSmith run identity without discarding source fields", () => {
    expect(
      normalizeManagedProviderEvent("langsmith", {
        id: "run-1",
        name: "tools.call",
        start_time: "2026-08-11T00:00:00Z",
      }),
    ).toMatchObject({ source_event_id: "run-1", action: "tools.call", agent: { id: "run-1" } });
  });
});
