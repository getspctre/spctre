import { describe, expect, it } from "vitest";
import {
  authorizeGovernedMcpTool,
  buildMcpAuditSeal,
  type GovernedMcpCapability,
} from "../src/governance.js";

const capabilities: GovernedMcpCapability[] = [
  {
    id: "cap-1",
    serverName: "github-mcp",
    toolName: "create_pull_request",
    connector: "github",
    action: "pull_request.create",
    description: "Open a pull request",
    inputSchema: {},
    metadata: {},
    grantScope: "AGENT",
  },
];

describe("MCP governance authorization", () => {
  it("allows an approved downstream MCP tool and seals the decision context", () => {
    const result = authorizeGovernedMcpTool({
      capabilities,
      workspaceId: "ws-1",
      agentId: "agent-1",
      serverName: "github-mcp",
      toolName: "create_pull_request",
      artifactHash: "artifact-1",
      sealSecret: "secret",
      issuedAt: "2026-01-01T00:00:00.000Z",
      decisionId: "decision-1",
    });

    expect(result.outcome).toBe("ALLOW");
    expect(result.capability?.id).toBe("cap-1");
    expect(result.auditSeal).toBe(buildMcpAuditSeal({
      decisionId: "decision-1",
      workspaceId: "ws-1",
      agentId: "agent-1",
      serverName: "github-mcp",
      toolName: "create_pull_request",
      connector: "github",
      action: "pull_request.create",
      outcome: "ALLOW",
      artifactHash: "artifact-1",
      issuedAt: "2026-01-01T00:00:00.000Z",
    }, "secret"));
  });

  it("denies undiscovered MCP tools and still emits a seal for evidence", () => {
    const result = authorizeGovernedMcpTool({
      capabilities,
      workspaceId: "ws-1",
      agentId: "agent-1",
      serverName: "slack-mcp",
      toolName: "post_message",
      connector: "slack",
      action: "message.post",
      sealSecret: "secret",
      issuedAt: "2026-01-01T00:00:00.000Z",
      decisionId: "decision-2",
    });

    expect(result.outcome).toBe("DENY");
    expect(result.capability).toBeUndefined();
    expect(result.reason).toContain("not approved");
    expect(result.auditSeal).toHaveLength(64);
  });

  it("builds the same audit seal regardless of input property insertion order", () => {
    const first = buildMcpAuditSeal({
      decisionId: "decision-3",
      workspaceId: "ws-1",
      agentId: "agent-1",
      serverName: "github-mcp",
      toolName: "create_pull_request",
      connector: "github",
      action: "pull_request.create",
      outcome: "ALLOW",
      artifactHash: null,
      issuedAt: "2026-01-01T00:00:00.000Z",
    }, "secret");

    const differentlyOrdered = {
      issuedAt: "2026-01-01T00:00:00.000Z",
      artifactHash: null,
      outcome: "ALLOW",
      action: "pull_request.create",
      connector: "github",
      toolName: "create_pull_request",
      serverName: "github-mcp",
      agentId: "agent-1",
      workspaceId: "ws-1",
      decisionId: "decision-3",
    } as const;

    expect(buildMcpAuditSeal(differentlyOrdered, "secret")).toBe(first);
  });
});
