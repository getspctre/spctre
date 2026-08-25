import { afterEach, describe, expect, it, vi } from "vitest";
import { isApprovalsQueueUri, resourceTypeForUri, SpctreMcpServer } from "../src/server.js";
import { TOOL_SCHEMAS } from "../src/tools/schemas.js";
import type { SpctreConfig } from "../src/config.js";

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

describe("SpctreMcpServer tool catalog", () => {
  it("constructs without a catalog/handler mismatch", () => {
    // The constructor runs assertToolCatalogConsistent(); a schema without a
    // handler (or vice versa) throws here.
    expect(() => new SpctreMcpServer(baseConfig)).not.toThrow();
  });

  it("advertises every declared tool schema with a unique name", () => {
    const names = TOOL_SCHEMAS.map((tool) => tool.name);
    expect(names.length).toBe(new Set(names).size);
    expect(names).toContain("evaluate_policy");
    expect(names).toContain("authorize_mcp_tool_call");
  });
});

describe("resource telemetry types", () => {
  it("uses a bounded route label instead of resource identifiers", () => {
    expect(resourceTypeForUri("spctre://evidence/decision-9b1deb4d-3b7d-4bad")).toBe("evidence");
    expect(resourceTypeForUri("spctre://approvals/approval-7f4a9c30")).toBe("approvals");
    expect(resourceTypeForUri("spctre://agents/scout/audit")).toBe("agents");
    expect(resourceTypeForUri("spctre://unknown/unique-value")).toBe("unknown");
  });
});

describe("resource route matching", () => {
  it("recognizes the approvals queue before the generic approval-ID route", () => {
    expect(isApprovalsQueueUri("spctre://approvals/queue")).toBe(true);
    expect(isApprovalsQueueUri("spctre://approvals/approval-7f4a9c30")).toBe(false);
  });
});

type PolicyGateInternals = {
  mergeMcpPolicyData(data: { allowedTools?: string[]; allowedConnectors?: string[] }): void;
  assertToolAllowed(toolName: string): Promise<void>;
  assertConnectorAllowed(connector: string | undefined): void;
  ensureMcpPolicyLoaded(options?: { agentId?: string; environment?: string }): Promise<void>;
  getWithAuth(path: string, params?: Record<string, unknown>): Promise<unknown>;
  mcpPolicyLoaded: boolean;
  mcpPolicyCacheKey: string;
};

// The gate is advisory (it runs in the agent's own process), but it must not
// widen an operator's env allowlist. Workspace policy currently serves the full
// first-party tool surface, so a union would erase every env restriction.
function gateFor(config: SpctreConfig): PolicyGateInternals {
  const gate = new SpctreMcpServer(config) as unknown as PolicyGateInternals;
  // Skip the control-plane fetch; tests drive mergeMcpPolicyData directly.
  gate.mcpPolicyCacheKey = `${config.agentId}:production`;
  gate.mcpPolicyLoaded = true;
  return gate;
}

describe("MCP tool/connector allowlist gate", () => {
  it("keeps the env allowlist restrictive after workspace policy loads", async () => {
    const gate = gateFor({ ...baseConfig, allowedTools: ["get_policy_status"] });
    gate.mergeMcpPolicyData({ allowedTools: TOOL_SCHEMAS.map((tool) => tool.name) });

    await expect(gate.assertToolAllowed("get_policy_status")).resolves.toBeUndefined();
    await expect(gate.assertToolAllowed("create_evidence_record")).rejects.toThrow(/not allowed/);
  });

  it("enforces a restrictive workspace policy when no env allowlist is set", async () => {
    const gate = gateFor(baseConfig);
    gate.mergeMcpPolicyData({ allowedTools: ["get_policy_status"] });

    await expect(gate.assertToolAllowed("get_policy_status")).resolves.toBeUndefined();
    await expect(gate.assertToolAllowed("create_evidence_record")).rejects.toThrow(/not allowed/);
  });

  // An omitted field and an empty array are distinguishable in JSON, so they get
  // different meanings: omitted leaves the layer unconstrained, empty is the
  // shape an operator would send to freeze a workspace pending review.
  it("treats an empty workspace allowlist as deny-all, not as no policy", async () => {
    const gate = gateFor(baseConfig);
    gate.mergeMcpPolicyData({ allowedTools: [] });

    await expect(gate.assertToolAllowed("get_policy_status")).rejects.toThrow(
      /not allowed by the workspace MCP policy/,
    );
  });

  it("leaves the layer unconstrained when the policy omits the field", async () => {
    const gate = gateFor(baseConfig);
    gate.mergeMcpPolicyData({ allowedConnectors: ["mcp"] });

    await expect(gate.assertToolAllowed("get_policy_status")).resolves.toBeUndefined();
  });

  it("treats an empty env allowlist as unset, since an empty variable parses to []", async () => {
    const gate = gateFor({ ...baseConfig, allowedTools: [] });
    gate.mergeMcpPolicyData({});

    await expect(gate.assertToolAllowed("get_policy_status")).resolves.toBeUndefined();
  });

  it("allows every tool when neither layer sets an allowlist", async () => {
    const gate = gateFor(baseConfig);
    gate.mergeMcpPolicyData({});

    await expect(gate.assertToolAllowed("create_evidence_record")).resolves.toBeUndefined();
  });

  it("applies the same both-layers rule to connectors", () => {
    const gate = gateFor({ ...baseConfig, allowedConnectors: ["mcp"] });
    gate.mergeMcpPolicyData({ allowedConnectors: ["mcp", "bedrock"] });

    expect(() => gate.assertConnectorAllowed("mcp")).not.toThrow();
    expect(() => gate.assertConnectorAllowed("bedrock")).toThrow(/not allowed/);
    expect(() => gate.assertConnectorAllowed(undefined)).toThrow(/not allowed/);
  });

  it("denies every connector when the policy sends an empty connector list", () => {
    const gate = gateFor(baseConfig);
    gate.mergeMcpPolicyData({ allowedConnectors: [] });

    expect(() => gate.assertConnectorAllowed("mcp")).toThrow(
      /not allowed by the workspace MCP policy/,
    );
  });
});

describe("MCP policy load failure handling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a failed policy fetch only after the backoff window", async () => {
    vi.useFakeTimers();
    const gate = new SpctreMcpServer(baseConfig) as unknown as PolicyGateInternals;
    const fetchPolicy = vi.fn().mockRejectedValue(new Error("control plane unreachable"));
    gate.getWithAuth = fetchPolicy;

    await gate.ensureMcpPolicyLoaded();
    await gate.ensureMcpPolicyLoaded();
    expect(fetchPolicy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29_000);
    await gate.ensureMcpPolicyLoaded();
    expect(fetchPolicy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await gate.ensureMcpPolicyLoaded();
    expect(fetchPolicy).toHaveBeenCalledTimes(2);
  });

  it("stops fetching once a policy load succeeds", async () => {
    const gate = new SpctreMcpServer(baseConfig) as unknown as PolicyGateInternals;
    const fetchPolicy = vi
      .fn()
      .mockResolvedValue({ data: { allowedTools: ["get_policy_status"] } });
    gate.getWithAuth = fetchPolicy;

    await gate.ensureMcpPolicyLoaded();
    await gate.ensureMcpPolicyLoaded();

    expect(fetchPolicy).toHaveBeenCalledTimes(1);
    await expect(gate.assertToolAllowed("create_evidence_record")).rejects.toThrow(/not allowed/);
  });

  it("shares one in-flight fetch across concurrent tool calls", async () => {
    const gate = new SpctreMcpServer(baseConfig) as unknown as PolicyGateInternals;
    const fetchPolicy = vi.fn().mockResolvedValue({ data: {} });
    gate.getWithAuth = fetchPolicy;

    await Promise.all([
      gate.ensureMcpPolicyLoaded(),
      gate.ensureMcpPolicyLoaded(),
      gate.ensureMcpPolicyLoaded(),
    ]);

    expect(fetchPolicy).toHaveBeenCalledTimes(1);
  });

  it("refetches when the agent/environment scope changes", async () => {
    const gate = new SpctreMcpServer(baseConfig) as unknown as PolicyGateInternals;
    const fetchPolicy = vi.fn().mockResolvedValue({ data: {} });
    gate.getWithAuth = fetchPolicy;

    await gate.ensureMcpPolicyLoaded({ environment: "production" });
    await gate.ensureMcpPolicyLoaded({ environment: "staging" });

    expect(fetchPolicy).toHaveBeenCalledTimes(2);
  });
});
