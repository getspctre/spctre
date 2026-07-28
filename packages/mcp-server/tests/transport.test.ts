import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { SpctreConfig } from "../src/config.js";
import { SpctreMcpServer } from "../src/server.js";
import { createHttpApp, startStdio } from "../src/transport.js";

const serveStdio = vi.hoisted(() => vi.fn());

vi.mock("@modelcontextprotocol/server/stdio", () => ({ serveStdio }));

const baseConfig: SpctreConfig = {
  apiBaseUrl: "http://localhost:3000",
  apiToken: "base-token",
  workspaceId: "ws-default",
  agentId: "agent-default",
  transport: "http",
  httpPort: 0,
  httpPath: "/mcp",
  requireBearerAuth: true,
  oauthIssuer: "https://auth.spctre.example",
  oauthResource: "https://mcp.spctre.example/mcp",
  oauthScopes: ["mcp:read", "mcp:write"],
};

const handles: Server[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => new Promise<void>((resolve) => handle.close(() => resolve()))));
  serveStdio.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function listen(app: ReturnType<typeof createHttpApp>["app"]): Promise<string> {
  const handle = app.listen(0);
  handles.push(handle);
  await new Promise<void>((resolve) => handle.once("listening", resolve));
  const address = handle.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return `http://127.0.0.1:${address.port}`;
}

function makeApp(config: SpctreConfig = baseConfig) {
  const createdServers: SpctreConfig[] = [];
  const app = createHttpApp(config, {
    createServer: (requestConfig) => {
      createdServers.push(requestConfig);
      return new SpctreMcpServer(requestConfig);
    },
    allowedSourceIps: new Set(),
  });
  return { ...app, createdServers };
}

function discoverRequest(): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
      "mcp-name": "spctre-test",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  };
}

describe("stateless HTTP transport", () => {
  it("requires bearer auth before creating a protocol server", async () => {
    const { app, createdServers } = makeApp();
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/mcp`, discoverRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
    expect(await response.json()).toEqual({ error: "Missing bearer token." });
    expect(createdServers).toEqual([]);
  });

  it("serves OAuth protected-resource metadata for remote clients", async () => {
    const { app } = makeApp();
    const baseUrl = await listen(app);
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      resource: "https://mcp.spctre.example/mcp",
      authorization_servers: ["https://auth.spctre.example"],
      scopes_supported: ["mcp:read", "mcp:write"],
      bearer_methods_supported: ["header"],
    }));
  });

  it("creates an isolated protocol server for each stateless request", async () => {
    const { app, createdServers } = makeApp();
    const baseUrl = await listen(app);

    const first = await fetch(`${baseUrl}/mcp`, { ...discoverRequest(), headers: { ...discoverRequest().headers, authorization: "Bearer token-a", "x-spctre-workspace-id": "ws-a", "x-spctre-agent-id": "agent-a" } });
    const second = await fetch(`${baseUrl}/mcp`, { ...discoverRequest(), headers: { ...discoverRequest().headers, authorization: "Bearer token-b", "x-spctre-workspace-id": "ws-b", "x-spctre-agent-id": "agent-b" } });

    expect(first.status, await first.text()).toBe(200);
    expect(second.status, await second.text()).toBe(200);
    expect(createdServers.map((config) => [config.apiToken, config.workspaceId, config.agentId])).toEqual([
      ["token-a", "ws-a", "agent-a"],
      ["token-b", "ws-b", "agent-b"],
    ]);
  });

  it("does not expose the legacy SSE or session-message endpoints", async () => {
    const { app } = makeApp();
    const baseUrl = await listen(app);

    expect((await fetch(`${baseUrl}/sse`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/message?sessionId=legacy`, { method: "POST" })).status).toBe(404);
  });
});

describe("modern STDIO transport", () => {
  it("uses the v2 stdio entry point with legacy negotiation through 2026", async () => {
    serveStdio.mockReturnValue({ close: vi.fn() });
    vi.spyOn(process, "on").mockImplementation(() => process);

    await startStdio({ ...baseConfig, transport: "stdio" });

    expect(serveStdio).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ legacy: "serve" }));
    const factory = serveStdio.mock.calls[0]?.[0];
    const protocolServer = factory({ era: "modern" });
    expect(protocolServer.constructor.name).toBe("Server");
    await protocolServer.close();
  });

  it("rejects legacy stdio openings from 2027-01-01", async () => {
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    serveStdio.mockReturnValue({ close: vi.fn() });
    vi.spyOn(process, "on").mockImplementation(() => process);

    await startStdio({ ...baseConfig, transport: "stdio" });

    expect(serveStdio).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ legacy: "reject" }));
  });
});
