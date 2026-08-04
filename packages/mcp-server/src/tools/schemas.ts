// Declarative tool catalog for the MCP server. This is the single source of
// truth advertised by the ListTools handler. Each entry's `name` must have a
// matching handler in the server's dispatch table (SpctreMcpServer enforces
// this at construction). Extracted from index.ts (maintainability audit
// Hotspot 1) to end the ListTools/switch duplication: adding a tool is now a
// schema entry here plus one handler binding, with no third edit.

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_SCHEMAS: McpToolSchema[] = [
  {
    name: "evaluate_policy",
    description: "Evaluate whether a tool execution is allowed based on current policies",
    inputSchema: {
      type: "object",
      properties: {
        connector: { type: "string" },
        action: { type: "string" },
        agent_context: {
          type: "object",
          properties: {
            agent_id: { type: "string" },
            workspace_id: { type: "string" },
            environment: { type: "string", enum: ["dev", "staging", "prod", "production"] },
          },
          required: ["agent_id", "workspace_id"],
        },
        tool_context: {
          type: "object",
          properties: {
            amount: { type: "number" },
            target: { type: "string" },
            batch_size: { type: "integer" },
            raw_args: { type: "object" },
          },
        },
        risk_level: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
          default: "MEDIUM",
        },
      },
      required: ["connector", "action", "agent_context"],
    },
  },
  {
    name: "create_evidence_record",
    description: "Ingest a runtime decision (evidence) for audit",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string" },
        connector: { type: "string" },
        action: { type: "string" },
        agent_context: {
          type: "object",
          properties: { agent_id: { type: "string" }, workspace_id: { type: "string" } },
          required: ["agent_id", "workspace_id"],
        },
        outcome: { type: "string", enum: ["EXECUTED", "BLOCKED", "SKIPPED", "ERROR"] },
        result: { type: "object" },
        raw_evidence: { type: "object" },
        audit_seal: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["decision_id", "connector", "action", "agent_context"],
    },
  },
  {
    name: "escalate_to_review",
    description: "Manually escalate a decision to human review",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string" },
        reason: { type: "string" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL" },
        assignee: { type: "string" },
      },
      required: ["decision_id", "reason"],
    },
  },
  {
    name: "get_policy_status",
    description: "Query current policy state and metadata",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        environment: { type: "string", enum: ["dev", "staging", "prod", "production"] },
        connector: { type: "string" },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "get_effective_policy",
    description:
      "Resolve the composed runtime policy for a given agent, connector, and environment — returns the same bundle the decision gateway would evaluate",
    inputSchema: {
      type: "object",
      properties: {
        connector: { type: "string", description: "Connector identifier to filter rules for" },
        environment: {
          type: "string",
          enum: ["dev", "staging", "prod", "production"],
          description: "Target environment",
        },
        agent_id: { type: "string", description: "Agent identifier" },
      },
      required: ["connector"],
    },
  },
  {
    name: "list_pending_escalations",
    description:
      "Surface open HITL queue items with SLA elapsed time, for AI agents that need to surface governance blockers to their operators",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    },
  },
  {
    name: "get_compliance_status",
    description:
      "Return the latest compliance packet summary (evidence count, approval count, pass/fail, staleness) for the current workspace",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ingest_gateway_event",
    description:
      "Ingest a spctre.gateway.event.v1 payload into the evidence pipeline; intended for LiteLLM, Portkey, and Helicone gateway adapters acting as the MCP client",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["portkey", "helicone", "litellm"] },
        gateway_event_id: { type: "string" },
        model: { type: "string" },
        agent_id: { type: "string" },
        connector: { type: "string" },
        action: { type: "string" },
        tool_declarations: { type: "array", items: { type: "string" } },
        prompt_tokens: { type: "integer" },
        completion_tokens: { type: "integer" },
        latency_ms: { type: "number" },
        cost_usd: { type: "number" },
        event_timestamp: { type: "string" },
        environment: { type: "string", default: "production" },
        raw_event: { type: "object" },
      },
      required: ["provider", "gateway_event_id", "agent_id"],
    },
  },
  {
    name: "discover_mcp_tools",
    description:
      "Discover approved downstream MCP tools for this workspace and agent without taking over planning or execution",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        environment: { type: "string", default: "production" },
      },
    },
  },
  {
    name: "authorize_mcp_tool_call",
    description:
      "Authorize a downstream MCP tool call and return a cryptographic audit seal for the runtime wrapper to attach to evidence",
    inputSchema: {
      type: "object",
      properties: {
        server_name: { type: "string" },
        tool_name: { type: "string" },
        connector: { type: "string" },
        action: { type: "string" },
        agent_context: {
          type: "object",
          properties: {
            agent_id: { type: "string" },
            workspace_id: { type: "string" },
            environment: { type: "string" },
          },
        },
        tool_arguments: { type: "object" },
      },
      required: ["server_name", "tool_name"],
    },
  },
];
