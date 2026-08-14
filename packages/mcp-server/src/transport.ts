// HTTP and STDIO transport bootstrap. Both use MCP's 2026-07-28 entry points:
// HTTP creates a protocol server per request, and STDIO negotiates the modern
// protocol before pinning one server for the connection lifetime.

import express, { type Application, type Request, type Response } from "express";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import axios from "axios";
import { incrementCounter, logger, shutdownTelemetry } from "./observability.js";
import { SpctreMcpServer } from "./server.js";
import type { SpctreConfig } from "./config.js";
import { buildToolMetricsSnapshot } from "./metrics.js";
import { errorMessage } from "./handlers/context.js";
import { parseBearerFromAuthHeader, parseAllowedSourceIps, getClientIp } from "./util.js";
import { TokenBucketRateLimiter, rateLimitKey, type RateLimiter } from "./rate-limit.js";

// Serve legacy stdio clients through 2026-12-31. Beginning 2027-01-01, the
// server rejects claim-less 2025-era openings and accepts only modern MCP.
const LEGACY_STDIO_SUNSET_AT = Date.UTC(2027, 0, 1);

function stdioLegacyMode(): "serve" | "reject" {
  return Date.now() < LEGACY_STDIO_SUNSET_AT ? "serve" : "reject";
}

export interface HttpTransportApp {
  app: Application;
}

interface HttpTransportDeps {
  createServer?: (config: SpctreConfig) => SpctreMcpServer;
  allowedSourceIps?: Set<string>;
  // Pass null to force-disable the limiter (tests); omit to derive from config.
  rateLimiter?: RateLimiter | null;
}

export async function startStdio(config: SpctreConfig): Promise<void> {
  if (!config.apiToken && !config.apiRefreshToken) {
    throw new Error("STDIO mode requires SPCTRE_API_TOKEN or SPCTRE_API_REFRESH_TOKEN.");
  }

  // serveStdio owns the opening exchange for the 2026 protocol. It creates
  // and pins one instance only after the client chooses the protocol era.
  // Keep legacy negotiation enabled through 2026-12-31 so existing 2025
  // clients can upgrade while modern clients use server/discover and envelope
  // claims. The deadline is enforced by stdioLegacyMode, not a manual task.
  const instances = new Set<SpctreMcpServer>();
  const legacyMode = stdioLegacyMode();
  const handle = serveStdio(
    () => {
      const server = new SpctreMcpServer(config);
      instances.add(server);
      return server.protocolServer();
    },
    {
      legacy: legacyMode,
      onerror: (error) =>
        logger.error("STDIO MCP transport failed", { error: errorMessage(error) }),
    },
  );
  logger.info("MCP server running in modern STDIO mode", {
    transport: "stdio",
    protocol: "2026-07-28",
    legacy_compatibility: legacyMode === "serve",
    legacy_compatibility_expires_on: "2026-12-31",
  });

  const shutdown = async () => {
    // serveStdio closes the protocol servers it owns. Revoke credentials from
    // every wrapper first, including a short-lived probe created during
    // protocol-era negotiation.
    await Promise.all([...instances].map((server) => server.revokeTokensBestEffort()));
    await handle.close();
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

/** Exempt from the control plane's source-IP allowlist, and free of database work. */
export const UPSTREAM_HEALTH_PATH = "/api/health";

export function createHttpApp(
  config: SpctreConfig,
  deps: HttpTransportDeps = {},
): HttpTransportApp {
  if (!config.requireBearerAuth) {
    throw new Error(
      "HTTP transport requires bearer authentication; SPCTRE_MCP_REQUIRE_BEARER_AUTH=false is unsupported.",
    );
  }

  const app = express();
  const allowedSourceIps = deps.allowedSourceIps ?? parseAllowedSourceIps();
  const createServer =
    deps.createServer ?? ((requestConfig: SpctreConfig) => new SpctreMcpServer(requestConfig));
  const rateLimiter =
    deps.rateLimiter === undefined
      ? config.httpRateLimitPerSecond > 0
        ? new TokenBucketRateLimiter({
            perSecond: config.httpRateLimitPerSecond,
            burst: config.httpRateLimitBurst,
          })
        : null
      : deps.rateLimiter;
  const oauthResource =
    config.oauthResource ?? `${config.apiBaseUrl.replace(/\/$/, "")}${config.httpPath}`;
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
    // Probe the control plane's health endpoint, not its root. The root is an
    // application page behind both proxy gates, so where an operator source-IP
    // allowlist is configured it answers 403 to this service — which egresses
    // from a platform address that is not, and cannot be, an operator address.
    // Readiness then reported the control plane unreachable while it was
    // serving this server's requests normally.
    //
    // /api/health is exempt from the allowlist by design and does not touch the
    // database, so this reports reachability without making this server's
    // readiness follow the control plane's storage.
    const probeUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}${UPSTREAM_HEALTH_PATH}`;
    try {
      await axios.get(probeUrl, { timeout: 3_000 });
      res.json({
        ok: true,
        unit: "mcp-server",
        stateless: true,
        checks: { upstream: { ok: true } },
      });
    } catch {
      res
        .status(503)
        .json({
          ok: false,
          unit: "mcp-server",
          stateless: true,
          checks: { upstream: { ok: false, reason: `Upstream ${probeUrl} unreachable` } },
        });
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

    // Per-caller throttle before the expensive path (server construction plus
    // control-plane fan-out). Keyed on the bearer token so one caller cannot
    // starve others sharing an egress IP.
    if (rateLimiter) {
      const decision = rateLimiter.check(rateLimitKey(bearer, getClientIp(req)));
      if (!decision.allowed) {
        incrementCounter("spctre.mcp.request.rejected", 1, { reason: "rate_limit" });
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
        res
          .status(429)
          .json({
            error: "Rate limit exceeded. Slow down and retry.",
            retryAfterMs: decision.retryAfterMs,
          });
        return;
      }
    }

    // HTTP MCP is a caller-authenticated boundary. Never let the service's
    // process credential stand in for a missing caller credential: it would
    // make a scope failure appear to belong to the caller and could cross the
    // workspace boundary carried by that caller's bearer token.
    const requestConfig: SpctreConfig = {
      ...config,
      apiToken: bearer,
      apiRefreshToken: undefined,
      workspaceId: req.header("x-spctre-workspace-id") || config.workspaceId,
      agentId: req.header("x-spctre-agent-id") || config.agentId,
    };
    const mcpServer = createServer(requestConfig);
    const handler = createMcpHandler(() => mcpServer.protocolServer());

    try {
      await toNodeHandler(handler, {
        onerror: (error) =>
          logger.error("Stateless MCP request failed", { error: errorMessage(error) }),
      })(req, res, next);
    } catch (error) {
      incrementCounter("spctre.mcp.request.errors", 1, { transport: "http" });
      if (!res.headersSent)
        res.status(500).json({ error: errorMessage(error) || "MCP request failed." });
    }
  });

  return { app };
}
