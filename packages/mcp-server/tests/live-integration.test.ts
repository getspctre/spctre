import { describe, expect, it } from "vitest";
import axios, { type AxiosResponse } from "axios";
import type { SpctreConfig } from "../src/config.js";
import type { McpServerContext } from "../src/handlers/context.js";
import { createEvidenceRecord, evaluatePolicy } from "../src/handlers/tools.js";

const describeLive = process.env.SPCTRE_MCP_LIVE_TESTS === "1" ? describe : describe.skip;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when SPCTRE_MCP_LIVE_TESTS=1`);
  return value;
}

function parseToolText(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function liveContext(): McpServerContext {
  const config: SpctreConfig = {
    apiBaseUrl: requiredEnv("SPCTRE_API_URL"),
    apiToken: requiredEnv("SPCTRE_API_TOKEN"),
    workspaceId: requiredEnv("SPCTRE_WORKSPACE_ID"),
    agentId: process.env.SPCTRE_AGENT_ID || "mcp-live-test-agent",
    transport: "stdio",
    httpPort: 8090,
    ssePath: "/sse",
    messagePath: "/message",
    requireBearerAuth: true,
  };

  const client = axios.create({
    baseURL: config.apiBaseUrl,
    timeout: 10_000,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
  });

  return {
    config,
    getWithAuth: (path, params) => client.get(path, { params }),
    postWithAuth: (path, body, extraHeaders) => client.post(path, body, { headers: extraHeaders }),
    assertConnectorAllowed: () => {},
    fetchPublishedBundleRefs: async (workspaceId: string) => {
      const response: AxiosResponse = await client.get("/api/bundle/latest", { params: { workspace_id: workspaceId } });
      const body = response.data ?? {};
      return {
        branchId: body.branchId ?? response.headers["x-spctre-branch-id"],
        revisionId: body.revisionId ?? response.headers["x-spctre-revision-id"],
        artifactHash: body.artifactHash ?? response.headers["x-spctre-artifact-hash"],
      };
    },
    ensureMcpPolicyLoaded: async () => {},
    governedMcpCapabilities: [],
    mcpRegistrySource: "live",
  };
}

describeLive("live MCP gateway/evidence integration", () => {
  it("evaluates through /api/gateway/decide and persists MCP evidence to /api/evidence", async () => {
    const ctx = liveContext();
    const decisionId = `mcp-live-${Date.now()}`;

    const decision = parseToolText(await evaluatePolicy(ctx, {
      connector: process.env.SPCTRE_MCP_LIVE_CONNECTOR || "mcp-live",
      action: "live.integration.check",
      agent_context: {
        agent_id: ctx.config.agentId,
        workspace_id: ctx.config.workspaceId,
        environment: "production",
      },
      risk_level: "LOW",
    }));

    expect(decision.decision).toBeTruthy();
    expect(decision.decision_id).toMatch(/^mcp-/);

    const evidence = parseToolText(await createEvidenceRecord(ctx, {
      decision_id: decisionId,
      connector: process.env.SPCTRE_MCP_LIVE_CONNECTOR || "mcp-live",
      action: "live.integration.check",
      agent_context: {
        agent_id: ctx.config.agentId,
        workspace_id: ctx.config.workspaceId,
        environment: "production",
      },
      outcome: "EXECUTED",
      result: { latency_ms: decision.latency_ms ?? 0 },
      raw_evidence: { liveIntegration: true, gatewayDecisionId: decision.decision_id },
      tags: ["mcp-live-integration"],
    }));

    expect(evidence.evidence_id).toBe(decisionId);
    expect(evidence.audit_ready).toBe(true);
  });
});
