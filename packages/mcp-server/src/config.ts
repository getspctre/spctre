import { parseCsv } from "./util.js";

// Server configuration types and environment loading. Extracted from index.ts
// (maintainability audit Hotspot 1) so the class, transport, and composition
// root all depend on one config source rather than a shared monolith.

export type TransportMode = "stdio" | "http";

export interface SpctreConfig {
  apiBaseUrl: string;
  apiToken?: string;
  apiRefreshToken?: string;
  workspaceId: string;
  agentId: string;
  transport: TransportMode;
  httpPort: number;
  httpPath: string;
  requireBearerAuth: boolean;
  // Per-caller HTTP throttle. perSecond <= 0 disables the in-process limiter
  // (e.g. when an edge WAF/rate-limiter fronts the service).
  httpRateLimitPerSecond: number;
  httpRateLimitBurst: number;
  oauthIssuer?: string;
  oauthResource?: string;
  oauthScopes?: string[];
  allowedTools?: string[];
  allowedConnectors?: string[];
  auditSealSecret?: string;
}

export interface SessionConfigOverrides {
  apiToken?: string;
  workspaceId?: string;
  agentId?: string;
}

// Parse a finite numeric env var, falling back to a default for unset or
// malformed values so misconfiguration never yields NaN thresholds.
function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getBaseConfigFromEnv(): SpctreConfig {
  const transport = ((process.env.SPCTRE_MCP_TRANSPORT || "stdio").toLowerCase() === "http"
    ? "http"
    : "stdio") as TransportMode;

  return {
    apiBaseUrl: process.env.SPCTRE_API_URL || "http://localhost:3000",
    apiToken: process.env.SPCTRE_API_TOKEN || undefined,
    apiRefreshToken: process.env.SPCTRE_API_REFRESH_TOKEN || undefined,
    workspaceId: process.env.SPCTRE_WORKSPACE_ID || "ws-dev",
    agentId: process.env.SPCTRE_AGENT_ID || "mcp-client-default",
    transport,
    httpPort: Number(process.env.SPCTRE_MCP_HTTP_PORT || 8090),
    httpPath: process.env.SPCTRE_MCP_HTTP_PATH || "/mcp",
    requireBearerAuth: (process.env.SPCTRE_MCP_REQUIRE_BEARER_AUTH || "true").toLowerCase() !== "false",
    httpRateLimitPerSecond: numberFromEnv(process.env.SPCTRE_MCP_HTTP_RATE_LIMIT_PER_SECOND, 25),
    httpRateLimitBurst: numberFromEnv(process.env.SPCTRE_MCP_HTTP_RATE_LIMIT_BURST, 50),
    oauthIssuer: process.env.SPCTRE_MCP_OAUTH_ISSUER || process.env.SPCTRE_API_URL || undefined,
    oauthResource: process.env.SPCTRE_MCP_OAUTH_RESOURCE || undefined,
    oauthScopes: parseCsv(process.env.SPCTRE_MCP_OAUTH_SCOPES) ?? ["mcp:read", "mcp:write"],
    allowedTools: parseCsv(process.env.SPCTRE_ALLOWED_TOOLS),
    allowedConnectors: parseCsv(process.env.SPCTRE_ALLOWED_CONNECTORS),
    auditSealSecret: process.env.SPCTRE_MCP_AUDIT_SEAL_SECRET || undefined,
  };
}
