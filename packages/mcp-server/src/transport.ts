// HTTP and STDIO transport bootstrap. HTTP uses the MCP 2026-07-28 stateless
// handler: every request receives a freshly configured protocol server, so no
// in-memory session map or load-balancer affinity is required.

import express, { type Application, type Request, type Response } from "express";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import axios from "axios";
import { incrementCounter, logger, shutdownTelemetry } from "./observability.js";
import { SpctreMcpServer } from "./server.js";
import type { SpctreConfig } from "./config.js";
import { buildToolMetricsSnapshot } from "./metrics.js";
import { errorMessage } from "./handlers/context.js";
import { parseBearerFromAuthHeader, parseAllowedSourceIps, getClientIp } from "./util.js";

export interface HttpTransportApp {
  app: Application;
}

interface HttpTransportDeps {
  createServer?: (config: SpctreConfig) => SpctreMcpServer;
  allowedSourceIps?: Set<string>;
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
  const { app } = createHttpApp(config);
  const serverHandle = app.listen(config.httpPort, () => {
    logger.info("MCP server running in stateless HTTP mode", {
      transport: "http",
      port: config.httpPort,
      mcp_path: config.httpPath,
    });
  });

  const shutdown = async () => {
    await shutdownTelemetry().catch(() => {});
    serverHandle.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function createHttpApp(config: SpctreConfig, deps: HttpTransportDeps = {}): HttpTransportApp {
  const app = express();
  const allowedSourceIps = deps.allowedSourceIps ?? parseAllowedSourceIps();
  const createServer = deps.createServer ?? ((requestConfig: SpctreConfig) => new SpctreMcpServer(requestConfig));
  const oauthResource = config.oauthResource ?? `${config.apiBaseUrl.replace(/\/$/, "")}${config.httpPath}`;
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
    res.json({ status: "ok", mode: "http", stateless: true, mcpPath: config.httpPath });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    try {
      await axios.head(config.apiBaseUrl, { timeout: 3_000 });
      res.json({ ok: true, unit: "mcp-server", stateless: true, checks: { upstream: { ok: true } } });
    } catch {
      res.status(503).json({ ok: false, unit: "mcp-server", stateless: true, checks: { upstream: { ok: false, reason: `Upstream ${config.apiBaseUrl} unreachable` } } });
    }
  });

  app.get("/metricsz", (_req: Request, res: Response) => {
    res.json({ transport: "http", stateless: true, ...buildToolMetricsSnapshot() });
  });

  app.all(config.httpPath, async (req, res, next) => {
    const bearer = parseBearerFromAuthHeader(req.header("authorization") || undefined);
    if (config.requireBearerAuth && !bearer) {
      incrementCounter("spctre.mcp.request.rejected", 1, { reason: "missing_bearer" });
      res.setHeader("WWW-Authenticate", challenge("invalid_token"));
      res.status(401).json({ error: "Missing bearer token." });
      return;
    }

    const requestConfig: SpctreConfig = {
      ...config,
      apiToken: bearer || config.apiToken,
      workspaceId: req.header("x-spctre-workspace-id") || config.workspaceId,
      agentId: req.header("x-spctre-agent-id") || config.agentId,
    };
    const mcpServer = createServer(requestConfig);
    const handler = createMcpHandler(() => mcpServer.protocolServer());

    try {
      await toNodeHandler(handler, {
        onerror: (error) => logger.error("Stateless MCP request failed", { error: errorMessage(error) }),
      })(req, res, next);
    } catch (error) {
      incrementCounter("spctre.mcp.request.errors", 1, { transport: "http" });
      if (!res.headersSent) res.status(500).json({ error: errorMessage(error) || "MCP request failed." });
    }
  });

  return { app };
}
