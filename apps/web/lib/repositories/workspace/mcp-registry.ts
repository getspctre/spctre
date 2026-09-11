import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";
import type { TxClient } from "@/lib/db";
import { appendOperationsLogInTransaction } from "@/lib/repositories/operations-log";

export interface McpToolGrantRecord {
  id: string;
  workspaceId: string;
  /** null means every agent in the workspace. */
  agentId: string | null;
  /** "*" means every environment. */
  environment: string;
  allowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolRegistryEntry {
  id: string;
  serverName: string;
  serverUrl: string | null;
  toolName: string;
  connector: string;
  action: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  updatedAt: string;
  grants: McpToolGrantRecord[];
}

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
    description:
      "Record governed MCP tool-use evidence after the underlying runtime executes or blocks.",
    inputSchema: {},
    metadata: { firstParty: true },
    grantScope: "FALLBACK",
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

/**
 * The connectors this workspace may govern over MCP.
 *
 * DEFAULT_MCP_CONNECTORS is a list of *runtimes* — bedrock, langchain, crewai —
 * and was being served as the whole answer, so a governed `github` or `stripe`
 * tool call was refused on every deployment: the MCP server checks the
 * allowlist before the gateway is ever consulted, and no tenant, workspace or
 * registry row could add to a module constant. The connectors the policy packs
 * are built around were unreachable by construction.
 *
 * The tenant's own vocabulary answers it instead: the connector of every
 * installed pack, plus the connector of every registered tool. The defaults
 * stay in the union — they are the transport-level names the adapters use, and
 * removing them would break callers that rely on them today.
 */
export async function listGovernedMcpConnectors(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<string[]> {
  if (!sql) return [...DEFAULT_MCP_CONNECTORS];

  try {
    const rows = await sql<{ connector: string }[]>`
      SELECT DISTINCT pb.connector AS connector
      FROM policy_branch pb
      WHERE pb.tenant_id = ${params.tenantId}
        AND pb.workspace_id = ${params.workspaceId}
        AND pb.scope = 'CONNECTOR'
        AND pb.connector IS NOT NULL
      UNION
      SELECT DISTINCT r.connector AS connector
      FROM mcp_tool_registry r
      WHERE r.tenant_id = ${params.tenantId}
        AND r.status = 'ACTIVE'
    `;
    return mergeConnectors(rows.map((row) => row.connector));
  } catch {
    // A read failure must not silently narrow an allowlist: answering with the
    // defaults denies every governed connector the tenant installed, which is
    // exactly the failure this function exists to fix. Callers see the throw.
    throw new Error("Failed to resolve governed MCP connectors");
  }
}

/** Exported for the contract test; the union is the whole behaviour. */
export function mergeConnectors(tenantConnectors: readonly string[]): string[] {
  const merged = new Set<string>(DEFAULT_MCP_CONNECTORS);
  for (const connector of tenantConnectors) {
    const trimmed = typeof connector === "string" ? connector.trim() : "";
    if (trimmed) merged.add(trimmed);
  }
  return [...merged].sort();
}

// ── Registry writes ───────────────────────────────────────────────────────────
//
// These are the other half of listGovernedMcpCapabilities. Until they existed
// the two tables had a read path and nothing that ever wrote one, so a
// workspace could only answer DENY to every third-party MCP tool — correctly,
// and permanently.
//
// Registering a tool and granting it are governance acts, so each writes its
// operations-log entry inside the same transaction as the row it describes.
// appendOperationsLogInTransaction rethrows, so a registry change that cannot be
// audited does not commit — the opposite of the fire-and-forget
// appendOperationsLog used for reads and notifications.

export async function listMcpToolRegistry(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<McpToolRegistryEntry[]> {
  if (!sql) return [];

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
      status: "ACTIVE" | "DISABLED";
      created_at: Date;
      updated_at: Date;
      grants: unknown;
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
      r.status,
      r.created_at,
      r.updated_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', g.id,
              'workspaceId', g.workspace_id,
              'agentId', g.agent_id,
              'environment', g.environment,
              'allowed', g.allowed,
              'createdAt', g.created_at,
              'updatedAt', g.updated_at
            )
            ORDER BY g.created_at
          )
          FROM mcp_tool_grant g
          WHERE g.tenant_id = r.tenant_id
            AND g.registry_id = r.id
            AND g.workspace_id = ${params.workspaceId}
        ),
        '[]'::jsonb
      ) AS grants
    FROM mcp_tool_registry r
    WHERE r.tenant_id = ${params.tenantId}
    ORDER BY r.server_name ASC, r.tool_name ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    serverName: row.server_name,
    serverUrl: row.server_url,
    toolName: row.tool_name,
    connector: row.connector,
    action: row.action,
    description: row.description,
    inputSchema: asRecord(row.input_schema),
    metadata: asRecord(row.metadata),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    grants: asGrants(row.grants),
  }));
}

export async function registerMcpTool(params: {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  serverName: string;
  serverUrl?: string | null;
  toolName: string;
  connector: string;
  action: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  status?: "ACTIVE" | "DISABLED";
}): Promise<{ id: string; created: boolean }> {
  if (!sql) throw new Error("Database not configured.");

  return sql.begin(async (tx) => {
    const result = await upsertRegistryRow(tx, params);

    await appendOperationsLogInTransaction(tx, {
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "MCP_TOOL_REGISTERED",
      sourceId: result.id,
      sourceTable: "mcp_tool_registry",
      actorId: params.actorId,
      payload: {
        serverName: params.serverName,
        toolName: params.toolName,
        connector: params.connector,
        action: params.action,
        status: params.status ?? "ACTIVE",
        created: result.created,
      },
    });

    return result;
  });
}

async function upsertRegistryRow(
  tx: TxClient,
  params: {
    tenantId: string;
    serverName: string;
    serverUrl?: string | null;
    toolName: string;
    connector: string;
    action: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    status?: "ACTIVE" | "DISABLED";
  },
): Promise<{ id: string; created: boolean }> {
  // (tenant_id, server_name, tool_name) is unique, so re-registering a tool
  // updates it rather than forking the row every grant points at.
  const rows = await tx<{ id: string; created: boolean }[]>`
    INSERT INTO mcp_tool_registry (
      tenant_id, server_name, server_url, tool_name, connector, action,
      description, input_schema, metadata, status
    ) VALUES (
      ${params.tenantId}, ${params.serverName}, ${params.serverUrl ?? null},
      ${params.toolName}, ${params.connector}, ${params.action},
      ${params.description ?? ""},
      ${tx.json((params.inputSchema ?? {}) as JSONValue)}::jsonb,
      ${tx.json((params.metadata ?? {}) as JSONValue)}::jsonb,
      ${params.status ?? "ACTIVE"}
    )
    ON CONFLICT (tenant_id, server_name, tool_name) DO UPDATE SET
      server_url = EXCLUDED.server_url,
      connector = EXCLUDED.connector,
      action = EXCLUDED.action,
      description = EXCLUDED.description,
      input_schema = EXCLUDED.input_schema,
      metadata = EXCLUDED.metadata,
      status = EXCLUDED.status,
      updated_at = now()
    RETURNING id, (xmax = 0) AS created
  `;
  return rows[0];
}

export async function grantMcpTool(params: {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  registryId: string;
  /** null grants to every agent in the workspace. */
  agentId?: string | null;
  /** "*" grants in every environment. */
  environment?: string;
}): Promise<McpToolGrantRecord> {
  if (!sql) throw new Error("Database not configured.");

  return sql.begin(async (tx) => {
    const grant = await insertGrantRow(tx, params);
    if (!grant) throw new Error("MCP tool is not registered for this tenant.");

    await appendOperationsLogInTransaction(tx, {
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "MCP_TOOL_GRANTED",
      sourceId: grant.id,
      sourceTable: "mcp_tool_grant",
      actorId: params.actorId,
      payload: {
        registryId: params.registryId,
        // Spelled out rather than left as null: "every agent" and "one agent"
        // are different grants, and an audit reader should not have to know
        // that null means the wider one.
        agentId: grant.agentId,
        scope: grant.agentId ? "AGENT" : "WORKSPACE",
        environment: grant.environment,
      },
    });

    return grant;
  });
}

async function insertGrantRow(
  tx: TxClient,
  params: {
    tenantId: string;
    workspaceId: string;
    registryId: string;
    agentId?: string | null;
    environment?: string;
  },
): Promise<McpToolGrantRecord | null> {
  // mcp_tool_grant_unique_idx keys on COALESCE(agent_id, '*'), so a repeat
  // grant re-enables the existing row instead of creating a second one that
  // a later revoke would miss.
  const rows = await tx<
    {
      id: string;
      workspace_id: string;
      agent_id: string | null;
      environment: string;
      allowed: boolean;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    INSERT INTO mcp_tool_grant (
      tenant_id, workspace_id, registry_id, agent_id, environment, allowed
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.registryId},
      ${params.agentId ?? null}, ${params.environment ?? "*"}, true
    )
    ON CONFLICT (tenant_id, workspace_id, registry_id, COALESCE(agent_id, '*'), environment)
      DO UPDATE SET allowed = true, updated_at = now()
    RETURNING id, workspace_id, agent_id, environment, allowed, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    environment: row.environment,
    allowed: row.allowed,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function revokeMcpToolGrant(params: {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  grantId: string;
}): Promise<boolean> {
  if (!sql) throw new Error("Database not configured.");

  return sql.begin(async (tx) => {
    const revoked = await deleteGrantRow(tx, params);
    if (!revoked) return false;

    await appendOperationsLogInTransaction(tx, {
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "MCP_TOOL_REVOKED",
      sourceId: params.grantId,
      sourceTable: "mcp_tool_grant",
      actorId: params.actorId,
      payload: {
        registryId: revoked.registryId,
        agentId: revoked.agentId,
        scope: revoked.agentId ? "AGENT" : "WORKSPACE",
        environment: revoked.environment,
      },
    });

    return true;
  });
}

async function deleteGrantRow(
  tx: TxClient,
  params: { tenantId: string; workspaceId: string; grantId: string },
): Promise<{ registryId: string; agentId: string | null; environment: string } | null> {
  // Deleted rather than flipped to allowed = false: the grant is the record of
  // what may happen now, and the operations log is the record of what happened.
  // A retained `allowed = false` row would be a third state to reason about at
  // the authorization point, which reads only allowed = true.
  const rows = await tx<{ registry_id: string; agent_id: string | null; environment: string }[]>`
    DELETE FROM mcp_tool_grant
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND id = ${params.grantId}
    RETURNING registry_id, agent_id, environment
  `;
  const row = rows[0];
  if (!row) return null;
  return { registryId: row.registry_id, agentId: row.agent_id, environment: row.environment };
}

function asGrants(value: unknown): McpToolGrantRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string") return [];
    return [
      {
        id: record.id,
        workspaceId: String(record.workspaceId ?? ""),
        agentId: typeof record.agentId === "string" ? record.agentId : null,
        environment: String(record.environment ?? "*"),
        allowed: record.allowed !== false,
        // These arrive through jsonb_agg, so they are Postgres timestamp text
        // rather than Date instances. Normalised here so a grant's timestamps
        // read the same as the registry row's next to it.
        createdAt: isoOrEmpty(record.createdAt),
        updatedAt: isoOrEmpty(record.updatedAt),
      },
    ];
  });
}

function isoOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}
