import { describe, expect, it } from "vitest";
import { normalizeManagedProviderEvent } from "../lib/domains/evidence/managed-adapters";

describe("managed evidence adapters", () => {
  it("preserves AgentCore request and agent identity", () => {
    expect(
      normalizeManagedProviderEvent("bedrock_agentcore", {
        "aws.agent.id": "agent-1",
        "aws.request_id": "req-1",
        "aws.operation.name": "InvokeAgentRuntime",
        "aws.resource.arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/r-1",
      }),
    ).toMatchObject({
      source_event_id: "req-1",
      action: "InvokeAgentRuntime",
      agent: { id: "agent-1" },
      target_resource: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/r-1",
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

  it("normalizes Docker AI Governance sealed audit records", () => {
    expect(
      normalizeManagedProviderEvent("docker_ai_governance", {
        audit_event_id: "audit-1",
        timestamp: "2026-08-11T00:00:00Z",
        action_type: "network_egress",
        resource_id: "api.example.test:443",
        decision: "AUDIT_DECISION_DENY",
        agent: { name: "codex" },
      }),
    ).toMatchObject({
      source_event_id: "audit-1",
      action: "network_egress",
      target_resource: "api.example.test:443",
      enforcement_decision: "deny",
      agent: { id: "codex" },
    });
  });
});
