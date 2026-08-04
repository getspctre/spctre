import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  state,
  sqlMock,
  hasBearerTokenMock,
  authenticateServiceTokenMock,
  getAuthSessionMock,
  getActiveScopeMock,
} = vi.hoisted(() => {
  const state = { registryRows: [] as any[] };

  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("").replace(/\s+/g, " ").trim().toUpperCase();
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
      new Request("http://localhost/api/workspace/mcp-policy?agentId=agent-1", {
        headers: { Authorization: "Bearer token" },
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
      new Request("http://localhost/api/workspace/mcp-policy?agentId=agent-1", {
        headers: { Authorization: "Bearer token" },
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

  it("returns a stable denial envelope when the service token is invalid", async () => {
    authenticateServiceTokenMock.mockResolvedValueOnce({
      ok: false,
      error: "Token is missing bundle:read scope.",
    });

    const response = await GET(
      new Request("http://localhost/api/workspace/mcp-policy", {
        headers: { Authorization: "Bearer token" },
      }),
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
      new Request("http://localhost/api/workspace/mcp-policy?environment=staging"),
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

    const response = await GET(new Request("http://localhost/api/workspace/mcp-policy"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Authentication required.",
      meta: { version: "2026-01" },
    });
    expect(getActiveScopeMock).not.toHaveBeenCalled();
  });
});
