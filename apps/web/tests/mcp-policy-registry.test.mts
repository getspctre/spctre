import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const {
  state,
  sqlMock,
  hasBearerTokenMock,
  authenticateServiceTokenMock,
  getAuthSessionMock,
  getActiveScopeMock,
} = vi.hoisted(() => {
  const state = { registryRows: [] as any[], connectorRows: [] as any[], connectorsFail: false };

  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("").replace(/\s+/g, " ").trim().toUpperCase();
    // The connector vocabulary reads both tables at once, so it has to be
    // matched before the capability query it would otherwise look like.
    if (joined.includes("FROM POLICY_BRANCH")) {
      return state.connectorsFail
        ? Promise.reject(new Error("connection reset"))
        : Promise.resolve(state.connectorRows);
    }
    if (joined.includes("FROM MCP_TOOL_REGISTRY")) {
      return Promise.resolve(state.registryRows);
    }
    return Promise.resolve([]);
  };

  return {
    state,
    sqlMock: fn,
    hasBearerTokenMock: vi.fn(),
    authenticateServiceTokenMock: vi.fn(),
    getAuthSessionMock: vi.fn(),
    getActiveScopeMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ sql: sqlMock }));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, work: () => Promise<unknown>) => work(),
}));

vi.mock("@/lib/service-tokens", () => ({
  hasBearerToken: hasBearerTokenMock,
  authenticateServiceToken: authenticateServiceTokenMock,
}));

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionMock }));

vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeMock }));

import { GET } from "../app/api/workspace/mcp-policy/route";

describe("workspace MCP policy registry", () => {
  beforeEach(() => {
    state.registryRows = [];
    state.connectorRows = [];
    state.connectorsFail = false;
    hasBearerTokenMock.mockReset();
    authenticateServiceTokenMock.mockReset();
    getAuthSessionMock.mockReset();
    getActiveScopeMock.mockReset();
    hasBearerTokenMock.mockReturnValue(true);
    authenticateServiceTokenMock.mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        principalId: "svc-1",
        scopes: ["bundle:read"],
      },
    });
    getAuthSessionMock.mockRejectedValue(new Error("No session"));
    getActiveScopeMock.mockRejectedValue(new Error("No scope"));
  });

  it("returns fallback capabilities when no registry grants exist", async () => {
    const response = await GET(
      createRouteRequest({
        path: "/api/workspace/mcp-policy?agentId=agent-1",
        method: "GET",
        token: "token",
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.allowedTools).toContain("discover_mcp_tools");
    expect(data.allowedTools).toContain("authorize_mcp_tool_call");
    expect(data.registry.source).toBe("fallback");
    expect(data.capabilities.length).toBeGreaterThan(0);
    expect(data.capabilities[0].grantScope).toBe("FALLBACK");
  });

  it("returns registry-backed capabilities scoped to the service token workspace", async () => {
    state.registryRows = [
      {
        id: "cap-1",
        server_name: "github-mcp",
        server_url: "https://mcp.example.test/github",
        tool_name: "create_pull_request",
        connector: "github",
        action: "pull_request.create",
        description: "Open pull requests",
        input_schema: { type: "object" },
        metadata: { owner: "platform" },
        agent_id: "agent-1",
      },
    ];

    const response = await GET(
      createRouteRequest({
        path: "/api/workspace/mcp-policy?agentId=agent-1",
        method: "GET",
        token: "token",
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.registry.source).toBe("registry");
    expect(data.capabilities).toEqual([
      expect.objectContaining({
        id: "cap-1",
        serverName: "github-mcp",
        toolName: "create_pull_request",
        connector: "github",
        action: "pull_request.create",
        grantScope: "AGENT",
      }),
    ]);
  });

  // The MCP server checks this allowlist before it calls the gateway, so a
  // connector missing from it is refused without a decision being made. It was
  // a module constant of runtime names — bedrock, langchain, crewai — which is
  // why a governed `github` tool call was denied on every deployment.
  it("allows the connectors the tenant governs, not just the runtime defaults", async () => {
    state.connectorRows = [{ connector: "github" }, { connector: "stripe" }];

    const response = await GET(
      createRouteRequest({ path: "/api/workspace/mcp-policy", method: "GET", token: "token" }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.allowedConnectors).toContain("github");
    expect(data.allowedConnectors).toContain("stripe");
    // Still a superset: adapters address the control plane by runtime name.
    expect(data.allowedConnectors).toContain("langchain");
  });

  // Answering with the defaults would deny every connector the tenant
  // installed, which is the failure this list exists to fix. A 503 leaves the
  // MCP server on the policy it already cached instead.
  it("fails the read rather than narrowing the allowlist", async () => {
    state.connectorsFail = true;

    const response = await GET(
      createRouteRequest({ path: "/api/workspace/mcp-policy", method: "GET", token: "token" }),
    );

    expect(response.status).toBe(503);
  });

  it("returns a stable denial envelope when the service token is invalid", async () => {
    authenticateServiceTokenMock.mockResolvedValueOnce({
      ok: false,
      error: "Token is missing bundle:read scope.",
    });

    const response = await GET(
      createRouteRequest({ path: "/api/workspace/mcp-policy", method: "GET", token: "token" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      error: "Token is missing bundle:read scope.",
      meta: { version: "2026-01" },
    });
  });

  it("uses session workspace scope when no bearer token is present", async () => {
    hasBearerTokenMock.mockReturnValueOnce(false);
    getAuthSessionMock.mockResolvedValueOnce({ principalId: "principal-1" });
    getActiveScopeMock.mockResolvedValueOnce({
      tenantId: "tenant-session",
      workspaceId: "workspace-session",
    });

    const response = await GET(
      createRouteRequest({ path: "/api/workspace/mcp-policy?environment=staging", method: "GET" }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.registry).toMatchObject({
      workspaceId: "workspace-session",
      environment: "staging",
      source: "fallback",
    });
    expect(authenticateServiceTokenMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated session requests before resolving workspace scope", async () => {
    hasBearerTokenMock.mockReturnValueOnce(false);
    getAuthSessionMock.mockResolvedValueOnce(null);

    const response = await GET(
      createRouteRequest({ path: "/api/workspace/mcp-policy", method: "GET" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Authentication required.",
      meta: { version: "2026-01" },
    });
    expect(getActiveScopeMock).not.toHaveBeenCalled();
  });
});
