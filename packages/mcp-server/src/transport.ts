// HTTP/SSE and STDIO transport bootstrap for the MCP server. Extracted from
// index.ts (maintainability audit Hotspot 1). Owns the Express app, health and
// metrics routes, the SSE session map, and process shutdown wiring.

import express, { type Application, type Request, type Response } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import axios from "axios";
import { incrementCounter, logger, setGauge, shutdownTelemetry } from "./observability.js";
import { SpctreMcpServer } from "./server.js";
import type { SpctreConfig } from "./config.js";
import { MAX_HTTP_MESSAGES_PER_SECOND, MAX_HTTP_SESSIONS, buildToolMetricsSnapshot } from "./metrics.js";
import { errorMessage } from "./handlers/context.js";
import { parseBearerFromAuthHeader, parseAllowedSourceIps, getClientIp } from "./util.js";

interface HttpSession {
  server: Pick<SpctreMcpServer, "close" | "connectTransport">;
  transport: HttpSseTransport;
  bearer: string | null;
  messageWindowStartedAt: number;
  messageCount: number;
}

export interface HttpTransportApp {
  app: Application;
  sessions: Map<string, HttpSession>;
}

interface HttpTransportDeps {
  createServer?: (config: SpctreConfig) => Pick<SpctreMcpServer, "close" | "connectTransport">;
  createTransport?: (messagePath: string, res: Response) => HttpSseTransport;
  allowedSourceIps?: Set<string>;
}

interface HttpSseTransport extends Transport {
  sessionId: string;
  handlePostMessage: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

export async function startStdio(config: SpctreConfig): Promise<void> {
  if (!config.apiToken && !config.apiRefreshToken) {
    throw new Error("STDIO mode requires SPCTRE_API_TOKEN or SPCTRE_API_REFRESH_TOKEN.");
  }

  const transport = new StdioServerTransport();
  const server = new SpctreMcpServer(config);
  await server.connectTransport(transport);
  logger.info("MCP server running in STDIO mode", { transport: "stdio" });

  const shutdown = async () => {
    await server.close();
    await shutdownTelemetry().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startHttp(config: SpctreConfig): Promise<void> {
  const { app, sessions } = createHttpApp(config);
  const serverHandle = app.listen(config.httpPort, () => {
    logger.info("MCP server running in HTTP/SSE mode", {
      transport: "http",
      port: config.httpPort,
      sse_path: config.ssePath,
    });
  });

  const shutdown = async () => {
    for (const [, session] of sessions) {
      await session.server.close();
    }
    await shutdownTelemetry().catch(() => {});
    serverHandle.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function createHttpApp(config: SpctreConfig, deps: HttpTransportDeps = {}): HttpTransportApp {
  const app = express();
  const sessions = new Map<string, HttpSession>();
  const allowedSourceIps = deps.allowedSourceIps ?? parseAllowedSourceIps();
  const createServer = deps.createServer ?? ((sessionConfig: SpctreConfig) => new SpctreMcpServer(sessionConfig));
  const createTransport = deps.createTransport ?? ((messagePath: string, res: Response) => new SSEServerTransport(messagePath, res));
  const oauthResource = config.oauthResource ?? `${config.apiBaseUrl.replace(/\/$/, "")}${config.ssePath}`;
  const oauthMetadataPath = "/.well-known/oauth-protected-resource";

  const challenge = (error: string) =>
    `Bearer realm="spctre-mcp", error="${error}", resource_metadata="${oauthMetadataPath}"`;

  app.use((req, res, next) => {
    if (allowedSourceIps.size === 0 || req.path === "/healthz" || req.path === "/readyz") {
      next();
      return;
    }

    if (!allowedSourceIps.has(getClientIp(req))) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }

    next();
  });

  app.get(/^\/\.well-known\/oauth-protected-resource$/, (_req: Request, res: Response) => {
    res.json({
      resource: oauthResource,
      authorization_servers: config.oauthIssuer ? [config.oauthIssuer] : [],
      scopes_supported: config.oauthScopes ?? ["mcp:read", "mcp:write"],
      bearer_methods_supported: ["header"],
      resource_documentation: "https://docs.spctre.dev/mcp-server",
    });
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mode: "http",
      activeSessions: sessions.size,
      maxSessions: MAX_HTTP_SESSIONS,
      maxMessagesPerSecond: MAX_HTTP_MESSAGES_PER_SECOND,
    });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    const checks: Record<string, { ok: boolean; reason?: string }> = {};

    checks.capacity = sessions.size < MAX_HTTP_SESSIONS
      ? { ok: true }
      : { ok: false, reason: `At session capacity (${sessions.size}/${MAX_HTTP_SESSIONS})` };

    // Verify upstream API is reachable with a lightweight HEAD request.
    try {
      await axios.head(config.apiBaseUrl, { timeout: 3_000 });
      checks.upstream = { ok: true };
    } catch {
      checks.upstream = { ok: false, reason: `Upstream ${config.apiBaseUrl} unreachable` };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ ok: allOk, unit: "mcp-server", checks });
  });

  app.get("/metricsz", (_req: Request, res: Response) => {
    setGauge("spctre.mcp.http.active_sessions", sessions.size, { transport: "http" });
    const metrics: Record<string, unknown> = {
      transport: "http",
      activeSessions: sessions.size,
      ...buildToolMetricsSnapshot(),
    };
    res.json(metrics);
  });

  app.get(config.ssePath, async (req: Request, res: Response) => {
    // Backpressure: reject new connections when at capacity.
    if (sessions.size >= MAX_HTTP_SESSIONS) {
      incrementCounter("spctre.mcp.session.rejected", 1, { reason: "capacity" });
      logger.warn("MCP session rejected", { event: "mcp.session_rejected", reason: "capacity", active: sessions.size, limit: MAX_HTTP_SESSIONS });
      res.status(503).json({ error: "Server at capacity. Try again later.", activeSessions: sessions.size, maxSessions: MAX_HTTP_SESSIONS });
      return;
    }

    try {
      let bearer = parseBearerFromAuthHeader(req.header("authorization") || undefined);
      if (!bearer && process.env.NODE_ENV !== "production" && typeof req.query.token === "string" && req.query.token.trim()) {
        bearer = req.query.token.trim();
      }

      if (config.requireBearerAuth && !bearer) {
        res.setHeader("WWW-Authenticate", challenge("invalid_token"));
        res.status(401).json({ error: "Missing bearer token." });
        return;
      }

      const workspaceId = req.header("x-spctre-workspace-id") || config.workspaceId;
      const agentId = req.header("x-spctre-agent-id") || config.agentId;

      const sessionServer = createServer({
        ...config,
        apiToken: bearer || config.apiToken,
        workspaceId,
        agentId,
      });

      const transport = createTransport(config.messagePath, res);
      transport.onclose = async () => {
        sessions.delete(transport.sessionId);
        setGauge("spctre.mcp.http.active_sessions", sessions.size, { transport: "http" });
        incrementCounter("spctre.mcp.session.closed", 1, { transport: "http" });
        logger.info("MCP session closed", { event: "mcp.session_closed", session_id: transport.sessionId, active_after: sessions.size });
        await sessionServer.close();
      };

      await sessionServer.connectTransport(transport);
      sessions.set(transport.sessionId, {
        server: sessionServer,
        transport,
        bearer: bearer ?? null,
        messageWindowStartedAt: Date.now(),
        messageCount: 0,
      });
      setGauge("spctre.mcp.http.active_sessions", sessions.size, { transport: "http" });
      incrementCounter("spctre.mcp.session.opened", 1, { transport: "http" });
      logger.info("MCP session opened", { event: "mcp.session_opened", session_id: transport.sessionId, active: sessions.size });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) || "Failed to initialize SSE session." });
    }
  });

  app.post(config.messagePath, async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || "").trim();
    const session = sessions.get(sessionId);

    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    const bearer = parseBearerFromAuthHeader(req.header("authorization") || undefined);
    if (config.requireBearerAuth && (!bearer || bearer !== session.bearer)) {
      res.setHeader("WWW-Authenticate", challenge("invalid_token"));
      res.status(401).json({ error: "Missing or invalid bearer token." });
      return;
    }

    const now = Date.now();
    if (now - session.messageWindowStartedAt >= 1_000) {
      session.messageWindowStartedAt = now;
      session.messageCount = 0;
    }
    session.messageCount++;
    if (session.messageCount > MAX_HTTP_MESSAGES_PER_SECOND) {
      incrementCounter("spctre.mcp.message.rejected", 1, { reason: "rate_limit" });
      res.status(429).json({ error: "Too many MCP messages for this session. Try again later.", retryAfterMs: 1_000 });
      return;
    }

    // Express Request/Response structurally satisfy the SDK's node http shapes.
    await session.transport.handlePostMessage(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  });

  return { app, sessions };
}
