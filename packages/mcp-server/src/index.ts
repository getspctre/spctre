#!/usr/bin/env node

/**
 * Spctre MCP Server — composition root.
 *
 * Dual transport support:
 * - STDIO (default) for local clients
 * - Stateless Streamable HTTP for remote clients
 *
 * OAuth support:
 * - Static access token via SPCTRE_API_TOKEN
 * - Refresh token flow via SPCTRE_API_REFRESH_TOKEN + /api/token/refresh
 *
 * This file only wires telemetry, loads config, and dispatches to the selected
 * transport. Protocol logic lives in server.ts; transport bootstrap in
 * transport.ts.
 */

import { initTelemetry, logger } from "./observability.js";
import { getBaseConfigFromEnv } from "./config.js";
import { startStdio, startHttp } from "./transport.js";
import { SpctreMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = getBaseConfigFromEnv();

  // stdout is the MCP wire in stdio mode; operational logs must never be
  // interleaved with JSON-RPC frames. Configure this before telemetry starts.
  if (config.transport === "stdio") {
    process.env.SPCTRE_LOG_STDERR = "true";
  }

  initTelemetry(process.env.OTEL_SERVICE_NAME?.trim() || "spctre-mcp-server");

  if (config.transport === "http") {
    await startHttp(config);
  } else {
    await startStdio(config);
  }
}

main().catch((error) => {
  logger.error("Failed to start Spctre MCP Server", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});

export default SpctreMcpServer;
