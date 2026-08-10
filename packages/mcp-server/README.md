# Spctre MCP Server PoC

Model Context Protocol (MCP) server for Spctre policy governance. Enables standardized access to policy evaluation, evidence management, and governance workflows from any MCP-compatible client (Claude Code, ChatGPT, LangChain, CrewAI, etc.).

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Spctre backend running (http://localhost:3000)

### Installation

```bash
# From monorepo root
pnpm install

# Build the MCP server
cd packages/mcp-server
pnpm run build
```

For a published installation, `npx @spctre/mcp-server` starts the server
without cloning this repository.

### Running the Server

```bash
# Set environment variables
export SPCTRE_API_URL=http://localhost:3000
export SPCTRE_API_TOKEN=your-service-token
export SPCTRE_WORKSPACE_ID=ws-your-workspace
export SPCTRE_AGENT_ID=your-agent-id

# Start server (modern MCP 2026-07-28 STDIO)
node dist/index.js
```

### Running in Stateless Streamable HTTP Mode

```bash
# Remote transport mode
export SPCTRE_MCP_TRANSPORT=http
export SPCTRE_MCP_HTTP_PORT=8090
export SPCTRE_MCP_HTTP_PATH=/mcp
export SPCTRE_MCP_OAUTH_ISSUER=https://app.spctre.dev
export SPCTRE_MCP_OAUTH_RESOURCE=https://mcp.example.com/mcp
export SPCTRE_MCP_OAUTH_SCOPES=mcp:read,mcp:write

# OAuth-compatible auth options:
# Option A: static bearer token
export SPCTRE_API_TOKEN=your-access-token

# Option B: refresh-token flow (recommended)
export SPCTRE_API_REFRESH_TOKEN=your-refresh-token

node dist/index.js
```

HTTP endpoints:

- `POST /mcp` - stateless Streamable HTTP MCP requests
- `GET /healthz` - health and stateless transport info
- `GET /readyz` - upstream readiness checks
- `GET /metricsz` - rolling tool latency/error metrics
- `GET /.well-known/oauth-protected-resource` - OAuth 2.1 protected-resource metadata

Optional request headers:

- `Authorization: Bearer <token>`
- `x-spctre-workspace-id: <workspace-id>`
- `x-spctre-agent-id: <agent-id>`

HTTP mode enforces bearer auth by default and returns `WWW-Authenticate`
challenges with protected-resource metadata. The MCP 2026-07-28 handler is
stateless: each request can be routed to any server replica without a session
map or sticky load-balancer affinity.

### Using with a Client

The server communicates via modern MCP STDIO (the 2026-07-28 opening flow).
It also negotiates legacy 2025-era STDIO for existing clients during the
upgrade window, which ends on **2026-12-31**. From 2027-01-01, claim-less
legacy openings are rejected. In STDIO mode, operational logs go to stderr,
keeping stdout reserved for MCP frames. Example clients:

**Published package:**

```json
{
  "mcpServers": {
    "spctre": {
      "command": "npx",
      "args": ["@spctre/mcp-server"],
      "env": { "SPCTRE_API_URL": "https://app.spctre.dev", "SPCTRE_API_TOKEN": "your-token" }
    }
  }
}
```

**Claude Code Extension:**

```json
// ~/.claude/mcp-config.json
{
  "mcpServers": {
    "spctre": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "SPCTRE_API_URL": "http://localhost:3000",
        "SPCTRE_API_TOKEN": "your-token",
        "SPCTRE_WORKSPACE_ID": "ws-example",
        "SPCTRE_AGENT_ID": "claude-code-user"
      }
    }
  }
}
```

**LangChain Agent:**

```python
from langchain.agents import MCP

mcp = MCP(
    command="node",
    args=["/path/to/packages/mcp-server/dist/index.js"],
    env={
        "SPCTRE_API_URL": "http://localhost:3000",
        "SPCTRE_API_TOKEN": "your-token",
        "SPCTRE_WORKSPACE_ID": "ws-example",
        "SPCTRE_AGENT_ID": "langchain-agent",
    },
)
```

## Architecture

```
MCP Client (Claude, LangChain, etc.)
  ↓ JSON-RPC 2.0 over STDIO or stateless Streamable HTTP
Spctre MCP Server (this package)
  ├─ Tools (policy evaluation, evidence management)
  ├─ Resources (policies, evidence, audit trails)
  └─ Prompts (governance guidance templates)
    ↓ HTTP + Bearer token (auto-refresh supported)
  Spctre Control Plane APIs
    ↓
  Spctre Database
```

## Tools

### 1. `evaluate_policy`

Evaluate whether a tool execution is allowed based on current policies.

**Input:**

```typescript
{
  connector: string;           // stripe, github, aws, slack, etc.
  action: string;              // charge, execute, deploy, etc.
  agent_context: {
    agent_id: string;
    workspace_id: string;
    environment?: "dev" | "staging" | "prod";
  };
  tool_context?: {
    amount?: number;
    target?: string;
    batch_size?: number;
    raw_args?: Record<string, unknown>;
  };
  risk_level?: "LOW" | "MEDIUM" | "HIGH";  // default: MEDIUM
}
```

**Output:**

```json
{
  "decision": "ALLOW" | "DENY" | "WARN",
  "reason": "Human-readable explanation",
  "matched_rules": ["rule-id-1", "rule-id-2"],
  "policy_refs": [...],
  "decision_id": "hb-...",
  "escalation": {
    "escalated": boolean,
    "escalation_id": string,
    "sla_deadline": "ISO-8601 timestamp"
  },
  "confidence": 0.95,
  "latency_ms": 5
}
```

### 2. `create_evidence_record`

Ingest a runtime decision for audit and compliance.

**Input:**

```typescript
{
  decision_id: string;         // From evaluate_policy response
  connector: string;
  action: string;
  agent_context: {
    agent_id: string;
    workspace_id: string;
  };
  outcome: "EXECUTED" | "BLOCKED" | "SKIPPED" | "ERROR";
  result?: Record<string, unknown>;
  raw_evidence?: Record<string, unknown>;
  tags?: string[];
}
```

**Output:**

```json
{ "evidence_id": "ev-...", "persisted_at": "2024-05-07T...", "audit_ready": true }
```

### 3. `escalate_to_review`

Manually escalate a decision to human review.

**Input:**

```typescript
{
  decision_id: string;
  reason: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assignee?: string;
}
```

**Output:**

```json
{
  "escalation_id": "esc-...",
  "sla_deadline": "2024-05-07T18:30:00Z",
  "queue_position": 1,
  "status": "QUEUED"
}
```

### 4. `get_policy_status`

Query current policy state and metadata.

**Input:**

```typescript
{
  workspace_id: string;
  environment?: "dev" | "staging" | "prod";
  connector?: string;
}
```

**Output:**

```json
{
  "version": "rev-2024-05-07-v3",
  "approval_status": "PUBLISHED",
  "policies_count": 15,
  "connectors": [...],
  "artifact_hash": "sha256-...",
  "last_updated_at": "2024-05-07T..."
}
```

## Additional tools

In addition to the four core tools documented above, the server exposes:

- `get_effective_policy` — resolve the policy rules that apply to a connector.
- `list_pending_escalations` — list open human-review queue items.
- `get_compliance_status` — read the workspace compliance summary.
- `ingest_gateway_event` — ingest an LLM gateway event as evidence.
- `discover_mcp_tools` — list policy-approved downstream MCP tools.
- `authorize_mcp_tool_call` — authorize a downstream MCP call and return its audit seal.

## Resources

### 1. `/policies/{branch_id}/current`

Active policy set for a branch.

**URI:** `spctre://policies/main/current`

**Response:**

```json
{
  "branch_id": "main",
  "revision_id": "rev-2024-05-07-v3",
  "policies": [...],
  "approval_status": "PUBLISHED",
  "published": true
}
```

### 2. `/evidence/{decision_id}`

Audit trail for a specific decision.

**URI:** `spctre://evidence/hb-20240507-stripe-charge-12345`

**Response:**

```json
{
  "decision_id": "hb-...",
  "decision": "WARN",
  "reason": "...",
  "matched_rules": [...],
  "escalation": {...}
}
```

### 3. `/approvals/{approval_id}`

Approval workflow state.

**URI:** `spctre://approvals/apr-12345`

**Response:**

```json
{ "approval_id": "apr-12345", "status": "PENDING", "sla_deadline": "2024-05-07T..." }
```

### 4. `/agents/{agent_id}/audit`

Full audit history for an agent.

**URI:** `spctre://agents/agent-123/audit`

**Response:**

```json
{
  "agent_id": "agent-123",
  "decisions": [...],
  "summary": {
    "decisions_allowed": 42,
    "decisions_blocked": 3,
    "compliance_status": "COMPLIANT"
  }
}
```

## Prompts

### 1. `policy-governance-101`

Introduction to policy governance for AI agents. Provides context on when to call tools, how to interpret decisions, and best practices.

**Arguments:**

- `agent_id` (optional)
- `workspace_id` (optional)

### 2. `evidence-investigation`

Guide for investigating evidence and audit trails. Helps auditors understand how to query and interpret policy decisions.

**Arguments:**

- `workspace_id` (optional)

## Error Handling

All errors follow the MCP specification with standard JSON-RPC error codes:

| Code   | Error          | Description                                 |
| ------ | -------------- | ------------------------------------------- |
| -32700 | ParseError     | Invalid JSON received                       |
| -32600 | InvalidRequest | Invalid request format                      |
| -32601 | MethodNotFound | Unknown tool/resource                       |
| -32602 | InvalidParams  | Missing required parameters                 |
| -32603 | InternalError  | Server error (network, policy engine, etc.) |

**Example error response:**

```json
{
  "code": -32603,
  "message": "Internal error",
  "data": {
    "errorType": "PolicyEvaluationError",
    "errorCode": "POLICY_NOT_FOUND",
    "details": "Policy for connector 'stripe' not found"
  }
}
```

## Configuration

### Environment Variables

| Variable              | Required | Description                                                  |
| --------------------- | -------- | ------------------------------------------------------------ |
| `SPCTRE_API_URL`      | No       | Base URL for Spctre backend (default: http://localhost:3000) |
| `SPCTRE_API_TOKEN`    | Yes      | Bearer token for authentication                              |
| `SPCTRE_WORKSPACE_ID` | No       | Default workspace ID (default: ws-dev)                       |
| `SPCTRE_AGENT_ID`     | No       | Default agent ID (default: mcp-client-default)               |

### Token Configuration

Tokens should be obtained from Spctre:

```bash
# Via CLI
spctre token create --workspace ws-example --name "MCP Client"

# Via UI
# Workspace → Settings → API Tokens → Create Token
```

Tokens expire after 1 hour; use the refresh token to get a new access token.

## Examples

### Example 1: Evaluate Stripe Charge

```javascript
const result = await client.callTool({
  name: "evaluate_policy",
  arguments: {
    connector: "stripe",
    action: "charge",
    agent_context: { agent_id: "claude-code-alice", workspace_id: "ws-acme", environment: "prod" },
    tool_context: { amount: 5000, target: "customer-789" },
  },
});

// Result:
// {
//   "decision": "WARN",
//   "reason": "Amount $5000 requires approval",
//   "escalation": {
//     "escalated": true,
//     "sla_deadline": "2024-05-07T18:30:00Z"
//   }
// }
```

### Example 2: Query Agent Audit Trail

```javascript
const audit = await client.readResource({ uri: "spctre://agents/claude-code-alice/audit" });

// Returns all decisions made by this agent
```

### Example 3: Manual Escalation

```javascript
const result = await client.callTool({
  name: "escalate_to_review",
  arguments: {
    decision_id: "hb-20240507-stripe-charge-12345",
    reason: "High-confidence model uncertainty on new transaction type",
    priority: "HIGH",
  },
});

// Queues for human review with 4-hour SLA
```

## Testing

The test suite covers:

- Unit tests for each tool
- Resource fetch tests
- Multi-client composition tests
- Performance benchmarks
- Error handling validation

Quick test:

```bash
# Build
pnpm run build

# Run example (requires Spctre backend + API token)
pnpm run example
```

## Performance

- **Tool call latency:** < 5ms STDIO (local), < 50-100ms HTTP (remote)
- **Resource fetch latency:** < 50ms STDIO, < 200ms HTTP
- **Concurrent requests:** horizontally scalable without sticky sessions
- **Memory footprint:** ~50MB per server instance

## Deployment

### Local Development

```bash
node dist/index.js
```

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY packages/mcp-server ./

RUN npm install --prod

ENV SPCTRE_API_URL=http://spctre-api:3000
ENV SPCTRE_API_TOKEN=

CMD ["node", "dist/index.js"]
```

### Kubernetes

MCP server typically runs as a sidecar or init container on client agents (Claude Code, LangChain, etc.). Not a standalone service.

## Contributing

Contributions welcome! Areas for enhancement:

- [x] Stateless Streamable HTTP transport (MCP 2026-07-28)
- [x] OAuth 2.1 bearer auth and protected-resource metadata (Phase 2.3)
- [x] Rate limiting and backpressure
- [x] Enhanced error recovery for token refresh, upstream 401 retry, and degraded tool envelopes
- [x] Rolling latency/error metrics and `/metricsz`
- [x] Additional prompts and templates

Remaining live client matrix, soak, audit-trail, and hook/MCP coexistence tests
should live in the sibling `../spctre-e2e` repository.

## Related Documentation

- MCP_SERVER_CONTRACT.md — Complete tool/resource specs
- MCP_ARCHITECTURE_MAPPING.md — Architecture overview
- MCP_INTEGRATION_COMPATIBILITY.md — Compatibility assessment

## License

Same as Spctre project (see root LICENSE)
