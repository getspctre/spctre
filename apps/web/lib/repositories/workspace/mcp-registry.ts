import { sql } from "@/lib/db";

export interface GovernedMcpCapability {
  id: string;
  serverName: string;
  serverUrl?: string;
  toolName: string;
  connector: string;
  action: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  grantScope: "AGENT" | "WORKSPACE" | "FALLBACK";
}

export const DEFAULT_MCP_TOOLS = [
  "evaluate_policy",
  "create_evidence_record",
  "escalate_to_review",
  "get_policy_status",
  "get_effective_policy",
  "list_pending_escalations",
  "get_compliance_status",
  "ingest_gateway_event",
  "discover_mcp_tools",
  "authorize_mcp_tool_call",
];

export const DEFAULT_MCP_CONNECTORS = [
  "bedrock",
  "langchain",
  "crewai",
  "autogen",
  "openai-agents",
  "google-adk",
  "google-antigravity",
  "mcp",
];

const FALLBACK_CAPABILITIES: GovernedMcpCapability[] = [
  {
    id: "spctre-governance:evaluate_policy",
    serverName: "spctre-governance",
    toolName: "evaluate_policy",
    connector: "mcp",
    action: "evaluate_policy",
    description: "Evaluate a proposed tool use against the current Spctre policy context.",
    inputSchema: {},
    metadata: { firstParty: true },
    grantScope: "FALLBACK",
  },
  {
    id: "spctre-governance:create_evidence_record",
    serverName: "spctre-governance",
    toolName: "create_evidence_record",
    connector: "mcp",
    action: "create_evidence_record",
    description: "Record governed MCP tool-use evidence after the underlying runtime executes or blocks.",
    inputSchema: {},
    metadata: { firstParty: true },
    grantScope: "FALLBACK",
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function listGovernedMcpCapabilities(params: {
  tenantId: string;
  workspaceId: string;
  agentId?: string;
  environment?: string;
}): Promise<GovernedMcpCapability[]> {
  if (!sql) return FALLBACK_CAPABILITIES;

  const environment = params.environment?.trim() || "production";

  try {
    const rows = await sql<
      {
        id: string;
        server_name: string;
        server_url: string | null;
        tool_name: string;
        connector: string;
        action: string;
        description: string;
        input_schema: unknown;
        metadata: unknown;
        agent_id: string | null;
      }[]
    >`
      SELECT
        r.id,
        r.server_name,
        r.server_url,
        r.tool_name,
        r.connector,
        r.action,
        r.description,
        r.input_schema,
        r.metadata,
        g.agent_id
      FROM mcp_tool_registry r
      JOIN mcp_tool_grant g ON g.registry_id = r.id
        AND g.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${params.tenantId}
        AND g.workspace_id = ${params.workspaceId}
        AND r.status = 'ACTIVE'
        AND g.allowed = true
        AND (g.environment = '*' OR g.environment = ${environment})
        AND (g.agent_id IS NULL OR g.agent_id = ${params.agentId ?? null})
      ORDER BY r.server_name ASC, r.tool_name ASC
    `;

    if (rows.length === 0) return FALLBACK_CAPABILITIES;

    return rows.map((row) => ({
      id: row.id,
      serverName: row.server_name,
      serverUrl: row.server_url ?? undefined,
      toolName: row.tool_name,
      connector: row.connector,
      action: row.action,
      description: row.description,
      inputSchema: asRecord(row.input_schema),
      metadata: asRecord(row.metadata),
      grantScope: row.agent_id ? "AGENT" : "WORKSPACE",
    }));
  } catch {
    return FALLBACK_CAPABILITIES;
  }
}
