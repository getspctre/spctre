import { createHmac } from "node:crypto";

export interface GovernedMcpCapability {
  id: string;
  serverName: string;
  serverUrl?: string;
  toolName: string;
  connector: string;
  action: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  grantScope?: "AGENT" | "WORKSPACE" | "FALLBACK";
}

export interface AuditSealInput {
  decisionId: string;
  workspaceId: string;
  agentId: string;
  serverName: string;
  toolName: string;
  connector: string;
  action: string;
  outcome: "ALLOW" | "DENY";
  artifactHash?: string | null;
  issuedAt: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function stableJsonStringify(value: JsonValue): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalize non-finite JSON number.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(",")}}`;
}

export function buildMcpAuditSeal(input: AuditSealInput, secret: string): string {
  const canonical = stableJsonStringify({
    action: input.action,
    agentId: input.agentId,
    artifactHash: input.artifactHash ?? null,
    connector: input.connector,
    decisionId: input.decisionId,
    issuedAt: input.issuedAt,
    outcome: input.outcome,
    serverName: input.serverName,
    toolName: input.toolName,
    workspaceId: input.workspaceId,
  });
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function authorizeGovernedMcpTool(params: {
  capabilities: GovernedMcpCapability[];
  workspaceId: string;
  agentId: string;
  serverName: string;
  toolName: string;
  connector?: string;
  action?: string;
  artifactHash?: string | null;
  sealSecret: string;
  issuedAt?: string;
  decisionId?: string;
}): {
  decisionId: string;
  outcome: "ALLOW" | "DENY";
  reason: string;
  capability?: GovernedMcpCapability;
  auditSeal: string;
  issuedAt: string;
} {
  const issuedAt = params.issuedAt ?? new Date().toISOString();
  const decisionId =
    params.decisionId ?? `mcp-${params.serverName}-${params.toolName}-${Date.now()}`;

  const capability = params.capabilities.find((item) => {
    const connectorMatches = !params.connector || item.connector === params.connector;
    const actionMatches = !params.action || item.action === params.action;
    return (
      item.serverName === params.serverName &&
      item.toolName === params.toolName &&
      connectorMatches &&
      actionMatches
    );
  });

  const outcome = capability ? "ALLOW" : "DENY";
  const connector = params.connector ?? capability?.connector ?? "mcp";
  const action = params.action ?? capability?.action ?? params.toolName;
  const reason = capability
    ? `MCP tool ${params.serverName}.${params.toolName} is approved for this workspace and agent.`
    : `MCP tool ${params.serverName}.${params.toolName} is not approved for this workspace and agent.`;

  const auditSeal = buildMcpAuditSeal(
    {
      decisionId,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      serverName: params.serverName,
      toolName: params.toolName,
      connector,
      action,
      outcome,
      artifactHash: params.artifactHash,
      issuedAt,
    },
    params.sealSecret,
  );

  return { decisionId, outcome, reason, capability, auditSeal, issuedAt };
}
