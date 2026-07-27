import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Response } from "express";
import type { SpctreConfig } from "../src/config.js";
import { MAX_HTTP_MESSAGES_PER_SECOND } from "../src/metrics.js";
import { createHttpApp } from "../src/transport.js";

const baseConfig: SpctreConfig = {
  apiBaseUrl: "http://localhost:3000",
  apiToken: "base-token",
  workspaceId: "ws-default",
  agentId: "agent-default",
  transport: "http",
  httpPort: 0,
  ssePath: "/sse",
  messagePath: "/message",
  requireBearerAuth: true,
  oauthIssuer: "https://auth.spctre.example",
  oauthResource: "https://mcp.spctre.example/sse",
  oauthScopes: ["mcp:read", "mcp:write"],
};

const handles: Server[] = [];

afterEach(async () => {
  await Promise.all(
    handles.splice(0).map(
      (handle) => new Promise<void>((resolve) => handle.close(() => resolve())),
    ),
  );
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
  const postMessages: string[] = [];
  let nextSession = 1;
  const app = createHttpApp(config, {
    createServer: (sessionConfig) => {
      createdServers.push(sessionConfig);
      return {
        connectTransport: async () => {},
        close: async () => {},
      };
    },
    createTransport: (_messagePath: string, res: Response) => {
      const sessionId = `session-${nextSession++}`;
      queueMicrotask(() => {
        if (!res.headersSent) res.status(200).json({ sessionId });
      });
      return {
        sessionId,
        start: async () => {},
        send: async () => {},
        close: async () => {},
        handlePostMessage: async (_req: IncomingMessage, messageRes: ServerResponse) => {
          postMessages.push(sessionId);
          messageRes.statusCode = 202;
          messageRes.end(JSON.stringify({ ok: true, sessionId }));
        },
      };
    },
    allowedSourceIps: new Set(),
  });
  return { ...app, createdServers, postMessages };
}

describe("HTTP/SSE transport", () => {
  it("requires bearer auth for SSE sessions when configured", async () => {
    const { app } = makeApp();
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/sse`);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
    expect(await response.json()).toEqual({ error: "Missing bearer token." });
  });

  it("serves OAuth protected-resource metadata for remote clients", async () => {
    const { app } = makeApp();
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      resource: "https://mcp.spctre.example/sse",
      authorization_servers: ["https://auth.spctre.example"],
      scopes_supported: ["mcp:read", "mcp:write"],
      bearer_methods_supported: ["header"],
    }));
  });

  it("creates isolated sessions with per-client token, workspace, and agent scope", async () => {
    const { app, createdServers, sessions } = makeApp();
    const baseUrl = await listen(app);

    const first = await fetch(`${baseUrl}/sse`, {
      headers: {
        authorization: "Bearer token-a",
        "x-spctre-workspace-id": "ws-a",
        "x-spctre-agent-id": "agent-a",
      },
    });
    const second = await fetch(`${baseUrl}/sse`, {
      headers: {
        authorization: "Bearer token-b",
        "x-spctre-workspace-id": "ws-b",
        "x-spctre-agent-id": "agent-b",
      },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ sessionId: "session-1" });
    expect(await second.json()).toEqual({ sessionId: "session-2" });
    expect(sessions.size).toBe(2);
    expect(createdServers.map((config) => [config.apiToken, config.workspaceId, config.agentId])).toEqual([
      ["token-a", "ws-a", "agent-a"],
      ["token-b", "ws-b", "agent-b"],
    ]);
  });

  it("requires the same bearer token on message POSTs", async () => {
    const { app } = makeApp();
    const baseUrl = await listen(app);
    await fetch(`${baseUrl}/sse`, { headers: { authorization: "Bearer session-token" } });

    const response = await fetch(`${baseUrl}/message?sessionId=session-1`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    expect(await response.json()).toEqual({ error: "Missing or invalid bearer token." });
  });

  it("applies per-session message backpressure", async () => {
    const { app, postMessages } = makeApp();
    const baseUrl = await listen(app);
    await fetch(`${baseUrl}/sse`, { headers: { authorization: "Bearer session-token" } });

    const responses = [];
    for (let i = 0; i < MAX_HTTP_MESSAGES_PER_SECOND + 1; i++) {
      responses.push(await fetch(`${baseUrl}/message?sessionId=session-1`, {
        method: "POST",
        headers: { authorization: "Bearer session-token" },
      }));
    }

    expect(responses.slice(0, MAX_HTTP_MESSAGES_PER_SECOND).every((response) => response.status === 202)).toBe(true);
    expect(responses[MAX_HTTP_MESSAGES_PER_SECOND].status).toBe(429);
    expect(postMessages).toHaveLength(MAX_HTTP_MESSAGES_PER_SECOND);
  });
});
