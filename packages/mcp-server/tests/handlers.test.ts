import { describe, expect, it, vi } from "vitest";
import type { AxiosResponse } from "axios";
import type { SpctreConfig } from "../src/config.js";
import type { McpServerContext } from "../src/handlers/context.js";
import {
  evaluatePolicy,
  createEvidenceRecord,
  escalateToReview,
  getComplianceStatus,
  ingestGatewayEvent,
  discoverMcpTools,
  authorizeMcpToolCall,
} from "../src/handlers/tools.js";
import {
  getAgentAuditResource,
  getApprovalsQueueResource,
  getApprovalsResource,
  getEvidenceResource,
} from "../src/handlers/resources.js";

const baseConfig: SpctreConfig = {
  apiBaseUrl: "http://localhost:3000",
  apiToken: "test-token",
  workspaceId: "ws-test",
  agentId: "agent-test",
  transport: "stdio",
  httpPort: 8090,
  httpPath: "/mcp",
  requireBearerAuth: false,
  httpRateLimitPerSecond: 25,
  httpRateLimitBurst: 50,
};

function axiosResponse(data: unknown, headers: Record<string, unknown> = {}): AxiosResponse {
  return { data, headers, status: 200, statusText: "OK", config: {} } as unknown as AxiosResponse;
}

function makeContext(overrides: Partial<McpServerContext> = {}): McpServerContext {
  return {
    config: baseConfig,
    getWithAuth: async () => axiosResponse({}),
    postWithAuth: async () => axiosResponse({}),
    assertConnectorAllowed: () => {},
    fetchPublishedBundleRefs: async () => ({
      branchId: "b1",
      revisionId: "r1",
      artifactHash: "h1",
    }),
    ensureMcpPolicyLoaded: async () => {},
    governedMcpCapabilities: [],
    mcpRegistrySource: "api",
    ...overrides,
  };
}

// Parse the single text payload every handler wraps its result in.
function parseToolText(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}
function parseResourceText(result: { contents: Array<{ text: string }> }) {
  return JSON.parse(result.contents[0].text);
}

describe("agent audit resource", () => {
  it("uses the agent ID from the resource path, not the URI authority", async () => {
    const getWithAuth = vi.fn(async () =>
      axiosResponse({
        decisions: [],
        summary: { decisionsAllowed: 1, complianceStatus: "COMPLIANT" },
      }),
    );

    const result = await getAgentAuditResource(
      makeContext({ getWithAuth }),
      "spctre://agents/scout/audit",
    );

    expect(getWithAuth).toHaveBeenCalledWith("/api/agents/scout/audit", {
      workspace_id: "ws-test",
    });
    expect(parseResourceText(result).agent_id).toBe("scout");
  });
});

const evalArgs = {
  connector: "slack",
  action: "send",
  agent_context: { agent_id: "agent-test", workspace_id: "ws-test" },
};

describe("evaluatePolicy", () => {
  it("returns the decision envelope on success and enforces the connector", async () => {
    const assertConnectorAllowed = vi.fn();
    const ctx = makeContext({
      assertConnectorAllowed,
      postWithAuth: async () =>
        axiosResponse({
          decision: { outcome: "ALLOW", reason: "ok" },
          matchedRules: ["r1"],
          policyRefs: ["p1"],
        }),
    });

    const parsed = parseToolText(await evaluatePolicy(ctx, evalArgs));

    expect(assertConnectorAllowed).toHaveBeenCalledWith("slack");
    expect(parsed.decision).toBe("ALLOW");
    expect(parsed.reason).toBe("ok");
    expect(parsed.matched_rules).toEqual(["r1"]);
    expect(String(parsed.decision_id)).toMatch(/^mcp-/);
  });

  it("returns an ERROR envelope when the workspace does not match", async () => {
    const ctx = makeContext();
    const parsed = parseToolText(
      await evaluatePolicy(ctx, {
        ...evalArgs,
        agent_context: { agent_id: "a", workspace_id: "other-ws" },
      }),
    );
    expect(parsed.decision).toBe("ERROR");
    expect(parsed.error).toContain("Workspace mismatch");
  });

  it("returns an ERROR envelope when the connector is not allowed", async () => {
    const ctx = makeContext({
      assertConnectorAllowed: () => {
        throw new Error("Connector 'slack' is not allowed for this MCP session.");
      },
    });
    const parsed = parseToolText(await evaluatePolicy(ctx, evalArgs));
    expect(parsed.decision).toBe("ERROR");
    expect(parsed.error).toContain("not allowed");
  });

  it("calls the real gateway decision route with published policy context", async () => {
    const postWithAuth = vi.fn(async () =>
      axiosResponse({ decision: { outcome: "ESCALATE", reason: "review" }, latencyMs: 12 }),
    );
    const ctx = makeContext({
      fetchPublishedBundleRefs: async () => ({
        branchId: "branch-real",
        revisionId: "rev-real",
        artifactHash: "sha256:real",
      }),
      postWithAuth,
    });

    const parsed = parseToolText(
      await evaluatePolicy(ctx, {
        ...evalArgs,
        risk_level: "HIGH",
        tool_context: {
          raw_args: { amountUsd: 500, dataSensitivity: "restricted", trustScore: 0.3 },
        },
      }),
    );

    expect(postWithAuth).toHaveBeenCalledWith(
      "/api/gateway/decide",
      expect.objectContaining({
        connector: "slack",
        action: "send",
        artifactHash: "sha256:real",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "branch-real",
            revisionId: "rev-real",
            artifactHash: "sha256:real",
          },
        ],
        consequence: "HIGH",
        amountUsd: 500,
        dataSensitivity: "restricted",
        trustScore: 0.3,
      }),
    );
    expect(parsed.decision).toBe("ESCALATE");
    expect(parsed.latency_ms).toBe(12);
  });
});

describe("createEvidenceRecord", () => {
  const args = {
    decision_id: "d1",
    connector: "slack",
    action: "send",
    agent_context: { agent_id: "agent-test", workspace_id: "ws-test" },
    outcome: "EXECUTED",
  };

  it("persists evidence and reports audit_ready on success", async () => {
    const postWithAuth = vi.fn(async () =>
      axiosResponse({ evidence: { decisionId: "d1", tenantId: "t1" } }),
    );
    const ctx = makeContext({
      getWithAuth: async () =>
        axiosResponse({ branchId: "b1", revisionId: "r1", artifactHash: "h1", tenantId: "t1" }),
      postWithAuth,
    });
    const parsed = parseToolText(await createEvidenceRecord(ctx, args));
    expect(postWithAuth).toHaveBeenCalledWith("/api/evidence", expect.anything(), {
      "x-spctre-source": "mcp",
    });
    expect(parsed.evidence_id).toBe("d1");
    expect(parsed.audit_ready).toBe(true);
  });

  it("builds a gateway-compatible evidence payload with MCP source metadata", async () => {
    const postWithAuth = vi.fn(async () =>
      axiosResponse({ evidence: { decisionId: "d1", tenantId: "tenant-real" } }),
    );
    const ctx = makeContext({
      getWithAuth: async () =>
        axiosResponse({
          branchId: "branch-real",
          revisionId: "rev-real",
          artifactHash: "sha256:real",
          tenantId: "tenant-real",
        }),
      postWithAuth,
    });

    await createEvidenceRecord(ctx, {
      ...args,
      result: { latency_ms: 44 },
      raw_evidence: { downstream: "ok" },
      audit_seal: "seal-1",
      tags: ["mcp", "composition"],
    });

    expect(postWithAuth).toHaveBeenCalledWith(
      "/api/evidence",
      expect.objectContaining({
        decisionId: "d1",
        sourceType: "mcp",
        tenantId: "tenant-real",
        workspaceId: "ws-test",
        runtimeTarget: expect.objectContaining({ stack: "CUSTOM", adapter: "agt-compatible" }),
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "branch-real",
            revisionId: "rev-real",
            artifactHash: "sha256:real",
          },
        ],
        latencyMs: 44,
        rawEvidence: expect.objectContaining({ auditSeal: "seal-1", tags: ["mcp", "composition"] }),
      }),
      { "x-spctre-source": "mcp" },
    );
  });

  it("returns an error envelope when published bundle metadata is missing", async () => {
    const ctx = makeContext({ getWithAuth: async () => axiosResponse({}) });
    const parsed = parseToolText(await createEvidenceRecord(ctx, args));
    expect(parsed.error).toContain("Evidence creation failed");
  });
});

describe("multi-client composition", () => {
  it("keeps concurrent client evaluations scoped by workspace and token context", async () => {
    const calls: Array<{ workspaceId: string; path: string; body: unknown }> = [];
    const makeScopedContext = (workspaceId: string, token: string) =>
      makeContext({
        config: { ...baseConfig, workspaceId, apiToken: token, agentId: `agent-${workspaceId}` },
        fetchPublishedBundleRefs: async (requestedWorkspaceId) => ({
          branchId: `branch-${requestedWorkspaceId}`,
          revisionId: `rev-${requestedWorkspaceId}`,
          artifactHash: `sha256:${requestedWorkspaceId}`,
        }),
        postWithAuth: async (path, body) => {
          calls.push({ workspaceId, path, body });
          return axiosResponse({ decision: { outcome: "ALLOW", reason: `ok-${workspaceId}` } });
        },
      });

    const [a, b] = await Promise.all([
      evaluatePolicy(makeScopedContext("ws-a", "token-a"), {
        connector: "slack",
        action: "send",
        agent_context: { agent_id: "agent-ws-a", workspace_id: "ws-a" },
      }),
      evaluatePolicy(makeScopedContext("ws-b", "token-b"), {
        connector: "github",
        action: "pull_request.create",
        agent_context: { agent_id: "agent-ws-b", workspace_id: "ws-b" },
      }),
    ]);

    expect(parseToolText(a).reason).toBe("ok-ws-a");
    expect(parseToolText(b).reason).toBe("ok-ws-b");
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.path)).toEqual(["/api/gateway/decide", "/api/gateway/decide"]);
    expect(calls.map((call) => (call.body as Record<string, unknown>).workspaceId)).toEqual([
      "ws-a",
      "ws-b",
    ]);
    expect(calls.map((call) => (call.body as Record<string, unknown>).artifactHash)).toEqual([
      "sha256:ws-a",
      "sha256:ws-b",
    ]);
  });
});

describe("escalateToReview", () => {
  const args = { decision_id: "d1", reason: "needs review" };

  it("returns the upstream escalation on success", async () => {
    const ctx = makeContext({
      postWithAuth: async () =>
        axiosResponse({ escalationId: "esc-upstream", status: "QUEUED", queuePosition: 3 }),
    });
    const parsed = parseToolText(await escalateToReview(ctx, args));
    expect(parsed.escalation_id).toBe("esc-upstream");
    expect(parsed.queue_position).toBe(3);
  });

  it("falls back to a synthetic escalation when the upstream POST fails", async () => {
    const ctx = makeContext({
      postWithAuth: async () => {
        throw new Error("upstream down");
      },
    });
    const parsed = parseToolText(await escalateToReview(ctx, args));
    expect(parsed.status).toBe("QUEUED");
    expect(String(parsed.escalation_id)).toMatch(/^esc-/);
  });

  it("surfaces invalid args instead of falling through to the fallback", async () => {
    const ctx = makeContext();
    await expect(escalateToReview(ctx, { decision_id: "d1" })).rejects.toThrow(/Invalid arguments/);
  });
});

describe("getComplianceStatus", () => {
  it("passes the upstream body through on success", async () => {
    const ctx = makeContext({ getWithAuth: async () => axiosResponse({ status: "COMPLIANT" }) });
    const parsed = parseToolText(await getComplianceStatus(ctx));
    expect(parsed.status).toBe("COMPLIANT");
  });

  it("returns an error envelope when the upstream call fails", async () => {
    const ctx = makeContext({
      getWithAuth: async () => {
        throw new Error("boom");
      },
    });
    const parsed = parseToolText(await getComplianceStatus(ctx));
    expect(parsed.error).toContain("Compliance status unavailable");
  });
});

describe("ingestGatewayEvent", () => {
  it("calls the MCP gateway ingest route with gateway mode headers", async () => {
    const postWithAuth = vi.fn(async () =>
      axiosResponse({ decisionId: "gw-1", provenanceGap: false, deduplicated: true }),
    );
    const ctx = makeContext({ postWithAuth });

    const parsed = parseToolText(
      await ingestGatewayEvent(ctx, {
        provider: "portkey",
        gateway_event_id: "event-1",
        agent_id: "agent-test",
        connector: "openai",
        action: "chat.completions.create",
      }),
    );

    expect(postWithAuth).toHaveBeenCalledWith(
      "/api/gateway-ingest/mcp",
      expect.objectContaining({
        provider: "portkey",
        gateway_event_id: "event-1",
        agent_id: "agent-test",
      }),
      { "x-spctre-source": "mcp", "ingest-mode": "gateway" },
    );
    expect(parsed).toEqual({
      decision_id: "gw-1",
      provenance_gap: false,
      deduplicated: true,
      ingest_mode: "gateway",
    });
  });
});

describe("discoverMcpTools", () => {
  it("loads policy and returns the governed capabilities", async () => {
    const ensureMcpPolicyLoaded = vi.fn(async () => {});
    const ctx = makeContext({
      ensureMcpPolicyLoaded,
      governedMcpCapabilities: [
        { connector: "slack" },
      ] as unknown as McpServerContext["governedMcpCapabilities"],
      mcpRegistrySource: "workspace",
    });
    const parsed = parseToolText(await discoverMcpTools(ctx, { agent_id: "agent-test" }));
    expect(ensureMcpPolicyLoaded).toHaveBeenCalled();
    expect(parsed.registry_source).toBe("workspace");
    expect(parsed.count).toBe(1);
  });
});

describe("authorizeMcpToolCall", () => {
  it("denies when the audit seal secret is not configured", async () => {
    const ctx = makeContext();
    const parsed = parseToolText(
      await authorizeMcpToolCall(ctx, {
        server_name: "srv",
        tool_name: "tool",
        agent_context: { workspace_id: "ws-test", agent_id: "agent-test" },
      }),
    );
    expect(parsed.outcome).toBe("DENY");
    expect(parsed.error).toContain("SPCTRE_MCP_AUDIT_SEAL_SECRET");
  });

  it("returns an ALLOW envelope with audit seal and downstream execution contract", async () => {
    const ensureMcpPolicyLoaded = vi.fn(async () => {});
    const ctx = makeContext({
      config: { ...baseConfig, auditSealSecret: "seal-secret" },
      ensureMcpPolicyLoaded,
      getWithAuth: async () => axiosResponse({ artifactHash: "sha256:bundle" }),
      governedMcpCapabilities: [
        {
          id: "cap-github-pr",
          serverName: "github-mcp",
          toolName: "create_pull_request",
          connector: "github",
          action: "pull_request.create",
          description: "Open pull requests",
          inputSchema: {},
          metadata: {},
          grantScope: "AGENT",
        },
      ],
      mcpRegistrySource: "registry",
    });

    const parsed = parseToolText(
      await authorizeMcpToolCall(ctx, {
        server_name: "github-mcp",
        tool_name: "create_pull_request",
        connector: "github",
        action: "pull_request.create",
        agent_context: { workspace_id: "ws-test", agent_id: "agent-test", environment: "staging" },
      }),
    );

    expect(ensureMcpPolicyLoaded).toHaveBeenCalledWith({
      agentId: "agent-test",
      environment: "staging",
    });
    expect(parsed.outcome).toBe("ALLOW");
    expect(parsed.registry_source).toBe("registry");
    expect(parsed.capability.id).toBe("cap-github-pr");
    expect(String(parsed.audit_seal)).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.wrapper_contract).toEqual({
      execute_downstream: true,
      evidence_required: true,
      attach_fields: ["decision_id", "audit_seal", "server_name", "tool_name"],
    });
  });

  it("returns a DENY envelope with audit seal and blocks downstream execution for undiscovered tools", async () => {
    const ctx = makeContext({
      config: { ...baseConfig, auditSealSecret: "seal-secret" },
      governedMcpCapabilities: [],
      mcpRegistrySource: "fallback",
    });

    const parsed = parseToolText(
      await authorizeMcpToolCall(ctx, {
        server_name: "slack-mcp",
        tool_name: "post_message",
        connector: "slack",
        action: "message.post",
        agent_context: { workspace_id: "ws-test", agent_id: "agent-test" },
      }),
    );

    expect(parsed.outcome).toBe("DENY");
    expect(parsed.reason).toContain("not approved");
    expect(parsed.registry_source).toBe("fallback");
    expect(parsed.capability).toBeUndefined();
    expect(String(parsed.audit_seal)).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.wrapper_contract.execute_downstream).toBe(false);
    expect(parsed.wrapper_contract.evidence_required).toBe(true);
  });
});

describe("resource handlers", () => {
  it("getEvidenceResource passes the upstream body through", async () => {
    const ctx = makeContext({ getWithAuth: async () => axiosResponse({ decisionId: "d1" }) });
    const parsed = parseResourceText(await getEvidenceResource(ctx, "spctre://evidence/d1"));
    expect(parsed.decisionId).toBe("d1");
  });

  it("getApprovalsResource returns an error envelope when the lookup fails", async () => {
    const ctx = makeContext({
      getWithAuth: async () => {
        throw new Error("nope");
      },
    });
    const parsed = parseResourceText(await getApprovalsResource(ctx, "spctre://approvals/a1"));
    expect(parsed.error).toContain("Approval lookup failed");
    expect(parsed.approval_id).toBe("a1");
  });

  it("getApprovalsQueueResource reads the queue endpoint", async () => {
    const getWithAuth = vi.fn(async () => axiosResponse({ queue: [] }));
    const ctx = makeContext({ getWithAuth });
    const parsed = parseResourceText(await getApprovalsQueueResource(ctx, "spctre://approvals/queue"));
    expect(parsed.queue).toEqual([]);
    expect(getWithAuth).toHaveBeenCalledWith("/api/approvals/queue");
  });
});
