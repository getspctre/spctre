// SpctreMcpServer — MCP protocol surface (tools, resources, prompts) over a
// transport-agnostic Server instance. Extracted from index.ts (maintainability
// audit Hotspot 1); the transport bootstrap and composition root live in
// transport.ts and index.ts respectively.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { withSpan } from "@spctre/platform/tracing";
import {
  AccessTokenManager,
  emitTokenEvent,
  AXIOS_TIMEOUT_MS,
} from "./token.js";
import { type GovernedMcpCapability } from "./governance.js";
import { recordToolMetric } from "./metrics.js";
import { TOOL_SCHEMAS } from "./tools/schemas.js";
import type { SpctreConfig, SessionConfigOverrides } from "./config.js";
import type { McpServerContext } from "./handlers/context.js";
import {
  evaluatePolicy,
  createEvidenceRecord,
  escalateToReview,
  getPolicyStatus,
  getEffectivePolicy,
  listPendingEscalations,
  getComplianceStatus,
  ingestGatewayEvent,
  discoverMcpTools,
  authorizeMcpToolCall,
} from "./handlers/tools.js";
import {
  getPoliciesResource,
  getEvidenceResource,
  getApprovalsResource,
  getAgentAuditResource,
  getTrustHistoryResource,
  getIdentityEventsResource,
  getVerificationResultsResource,
  getWorkspacesListResource,
  getApprovalsQueueResource,
  getWorkflowConfigResource,
  getMembersListResource,
} from "./handlers/resources.js";
import { listPromptTemplates, renderPromptTemplate } from "./prompts.js";

// Workspace MCP policy payload as returned by /api/workspace/mcp-policy. Fields
// are validated at runtime before use, so they stay intentionally loose here.
interface McpPolicyData {
  allowedTools?: unknown;
  allowedConnectors?: unknown;
  capabilities?: unknown;
  registry?: { source?: string };
}

export class SpctreMcpServer {
  private readonly server: Server;
  private readonly config: SpctreConfig;
  private readonly apiClient: AxiosInstance;
  private readonly tokenManager: AccessTokenManager;
  private governedMcpCapabilities: GovernedMcpCapability[] = [];
  private mcpRegistrySource = "unloaded";
  // Seam passed to the extracted tool/resource handlers (handlers/*.ts).
  private readonly context: McpServerContext;
  private readonly toolHandlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
  >;

  constructor(config: SpctreConfig, overrides?: SessionConfigOverrides) {
    this.config = {
      ...config,
      apiToken: overrides?.apiToken ?? config.apiToken,
      workspaceId: overrides?.workspaceId ?? config.workspaceId,
      agentId: overrides?.agentId ?? config.agentId,
    };

    this.apiClient = axios.create({
      baseURL: this.config.apiBaseUrl,
      timeout: AXIOS_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.tokenManager = new AccessTokenManager({
      apiBaseUrl: this.config.apiBaseUrl,
      accessToken: this.config.apiToken,
      refreshToken: this.config.apiRefreshToken,
    });

    this.server = new Server(
      {
        name: "spctre",
        version: "0.2.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.context = this.createContext();
    this.toolHandlers = this.buildToolHandlers();
    this.assertToolCatalogConsistent();

    this.setupToolHandlers();
    this.setupResourceHandlers();
    this.setupPromptHandlers();
  }

  // Build the handler seam. Methods are private, so the extracted handlers
  // reach them through this delegating object; the two mutable fields are
  // exposed via getters so handlers always read their current value.
  private createContext(): McpServerContext {
    const server = this;
    return {
      config: this.config,
      getWithAuth: (path, params) => server.getWithAuth(path, params),
      postWithAuth: (path, body, extraHeaders) => server.postWithAuth(path, body, extraHeaders),
      assertConnectorAllowed: (connector) => server.assertConnectorAllowed(connector),
      fetchPublishedBundleRefs: (workspaceId) => server.fetchPublishedBundleRefs(workspaceId),
      ensureMcpPolicyLoaded: (options) => server.ensureMcpPolicyLoaded(options),
      get governedMcpCapabilities() {
        return server.governedMcpCapabilities;
      },
      get mcpRegistrySource() {
        return server.mcpRegistrySource;
      },
    };
  }

  // Single source of truth pairing each advertised tool schema with its
  // handler. ListTools serves TOOL_SCHEMAS; CallTool dispatches through this
  // map. Adding a tool means one schema entry plus one binding here.
  private buildToolHandlers(): Record<
    string,
    (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
  > {
    return {
      evaluate_policy: (args) => evaluatePolicy(this.context, args),
      create_evidence_record: (args) => createEvidenceRecord(this.context, args),
      escalate_to_review: (args) => escalateToReview(this.context, args),
      get_policy_status: (args) => getPolicyStatus(this.context, args),
      get_effective_policy: (args) => getEffectivePolicy(this.context, args),
      list_pending_escalations: (args) => listPendingEscalations(this.context, args),
      get_compliance_status: () => getComplianceStatus(this.context),
      ingest_gateway_event: (args) => ingestGatewayEvent(this.context, args),
      discover_mcp_tools: (args) => discoverMcpTools(this.context, args),
      authorize_mcp_tool_call: (args) => authorizeMcpToolCall(this.context, args),
    };
  }

  // Fail fast at construction if the advertised catalog and the dispatch table
  // ever drift apart, so a schema without a handler (or vice versa) can never
  // ship.
  private assertToolCatalogConsistent(): void {
    const schemaNames = new Set(TOOL_SCHEMAS.map((tool) => tool.name));
    const handlerNames = new Set(Object.keys(this.toolHandlers));
    for (const name of schemaNames) {
      if (!handlerNames.has(name)) {
        throw new Error(`MCP tool "${name}" is advertised but has no handler.`);
      }
    }
    for (const name of handlerNames) {
      if (!schemaNames.has(name)) {
        throw new Error(`MCP tool handler "${name}" has no advertised schema.`);
      }
    }
  }

  async connectTransport(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.tokenManager.revokeBestEffort();
    await this.server.close();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOL_SCHEMAS };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return await withSpan("mcp.tool.call", {
        "mcp.tool.name": name,
        "mcp.transport": this.config.transport,
        "spctre.workspace_id": this.config.workspaceId,
        "spctre.agent_id": this.config.agentId,
      }, async (span) => {
        await this.assertToolAllowed(name);

        const t0 = Date.now();
        let isError = false;
        try {
          const handler = this.toolHandlers[name];
          if (!handler) {
            throw new Error(`Unknown tool: ${name}`);
          }
          return await handler(args ?? {});
        } catch (err) {
          isError = true;
          span.setAttribute("error.type", err instanceof Error ? err.name : "Error");
          throw err;
        } finally {
          recordToolMetric(name, Date.now() - t0, isError, this.config.transport);
        }
      });
    });
  }

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => withSpan("mcp.resources.list", {
      "mcp.transport": this.config.transport,
      "spctre.workspace_id": this.config.workspaceId,
    }, async () => {
      return {
        resources: [
          {
            uri: "spctre://policies/main/current",
            name: "Current Policies",
            description: "Active policy set for the current workspace",
            mimeType: "application/json",
          },
          {
            uri: "spctre://evidence/{decision_id}",
            name: "Evidence Record",
            description: "Audit trail for a specific decision",
            mimeType: "application/json",
          },
          {
            uri: "spctre://approvals/{approval_id}",
            name: "Approval Record",
            description: "State of a pending approval",
            mimeType: "application/json",
          },
          {
            uri: "spctre://agents/{agent_id}/audit",
            name: "Agent Audit Trail",
            description: "Decision history for a specific agent",
            mimeType: "application/json",
          },
          {
            uri: "spctre://trust/{agent_id}/history",
            name: "Trust Score History",
            description: "Trust score timeline for a specific agent from the §21 operations store",
            mimeType: "application/json",
          },
          {
            uri: "spctre://identity/{principal_id}/events",
            name: "Identity Lifecycle Events",
            description: "Identity lifecycle event log for a specific principal",
            mimeType: "application/json",
          },
          {
            uri: "spctre://verification/results",
            name: "Verification Results",
            description: "AGT verification run results for the current workspace",
            mimeType: "application/json",
          },
          {
            uri: "spctre://workspaces/list",
            name: "Workspace List",
            description: "All workspaces with their active policy branch and publication status",
            mimeType: "application/json",
          },
          {
            uri: "spctre://approvals/queue",
            name: "Pending Approval Queue",
            description: "Policy bundles awaiting review: assigned reviewers, approval status, and elapsed time",
            mimeType: "application/json",
          },
          {
            uri: "spctre://workflows/config",
            name: "Approval Workflow Config",
            description: "Approval workflow rules active for the current workspace and environment",
            mimeType: "application/json",
          },
          {
            uri: "spctre://members/list",
            name: "Member and Role List",
            description: "Current org members, their roles, and workspace-scoped grant overrides",
            mimeType: "application/json",
          },
        ],
      };
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const resourceType = uri.split("/").slice(2, 4).join("/") || "unknown";
      return await withSpan("mcp.resource.read", {
        "mcp.resource.type": resourceType,
        "mcp.transport": this.config.transport,
        "spctre.workspace_id": this.config.workspaceId,
      }, async () => {

      if (uri.startsWith("spctre://policies/")) {
        return await getPoliciesResource(this.context, uri);
      }
      if (uri.startsWith("spctre://evidence/")) {
        return await getEvidenceResource(this.context, uri);
      }
      if (uri.startsWith("spctre://approvals/")) {
        return await getApprovalsResource(this.context, uri);
      }
      if (uri.startsWith("spctre://agents/")) {
        return await getAgentAuditResource(this.context, uri);
      }
      if (uri.startsWith("spctre://trust/")) {
        return await getTrustHistoryResource(this.context, uri);
      }
      if (uri.startsWith("spctre://identity/")) {
        return await getIdentityEventsResource(this.context, uri);
      }
      if (uri.startsWith("spctre://verification/")) {
        return await getVerificationResultsResource(this.context, uri);
      }
      if (uri === "spctre://workspaces/list") {
        return await getWorkspacesListResource(this.context, uri);
      }
      if (uri === "spctre://approvals/queue") {
        return await getApprovalsQueueResource(this.context, uri);
      }
      if (uri.startsWith("spctre://workflows/")) {
        return await getWorkflowConfigResource(this.context, uri);
      }
      if (uri === "spctre://members/list") {
        return await getMembersListResource(this.context, uri);
      }

        throw new Error(`Unknown resource: ${uri}`);
      });
    });
  }

  private setupPromptHandlers(): void {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => withSpan("mcp.prompts.list", {
      "mcp.transport": this.config.transport,
      "spctre.workspace_id": this.config.workspaceId,
    }, async () => {
      return {
        prompts: listPromptTemplates(),
      };
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return await withSpan("mcp.prompt.get", {
        "mcp.prompt.name": name,
        "mcp.transport": this.config.transport,
        "spctre.workspace_id": this.config.workspaceId,
      }, async () => {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: renderPromptTemplate(name, args),
              },
            },
          ],
        };
      });
    });
  }

  private async assertToolAllowed(toolName: string): Promise<void> {
    await this.ensureMcpPolicyLoaded();
    if (!this.config.allowedTools || this.config.allowedTools.length === 0) {
      return;
    }

    if (!this.config.allowedTools.includes(toolName)) {
      throw new Error(`Tool '${toolName}' is not allowed for this MCP session.`);
    }
  }

  private assertConnectorAllowed(connector: string | undefined): void {
    if (!this.config.allowedConnectors || this.config.allowedConnectors.length === 0) {
      return;
    }

    if (!connector || !this.config.allowedConnectors.includes(connector)) {
      throw new Error(`Connector '${connector}' is not allowed for this MCP session.`);
    }
  }

  private async postWithAuth(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<AxiosResponse> {
    return await withSpan("mcp.upstream.post", { "http.route": path, "mcp.transport": this.config.transport }, async () => {
    const token = await this.tokenManager.getValidAccessToken();
    const headers = { Authorization: `Bearer ${token}`, ...extraHeaders };

    try {
      return await this.apiClient.post(path, body, { headers });
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 401 && this.config.apiRefreshToken) {
        await this.tokenManager.refresh();
        const refreshed = await this.tokenManager.getValidAccessToken();
        return await this.apiClient.post(path, body, {
          headers: { Authorization: `Bearer ${refreshed}`, ...extraHeaders },
        });
      }
      throw error;
    }
    });
  }

  private async getWithAuth(path: string, params?: Record<string, unknown>): Promise<AxiosResponse> {
    return await withSpan("mcp.upstream.get", { "http.route": path, "mcp.transport": this.config.transport }, async () => {
    const token = await this.tokenManager.getValidAccessToken();

    try {
      return await this.apiClient.get(path, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 401 && this.config.apiRefreshToken) {
        await this.tokenManager.refresh();
        const refreshed = await this.tokenManager.getValidAccessToken();
        return await this.apiClient.get(path, {
          params,
          headers: { Authorization: `Bearer ${refreshed}` },
        });
      }
      throw error;
    }
    });
  }

  // Resolve branch/revision/artifact refs for the published bundle, falling
  // back to response headers when the body omits them.
  private async fetchPublishedBundleRefs(workspaceId: string): Promise<{
    branchId: string;
    revisionId: string;
    artifactHash: string;
  }> {
    const bundleResponse = await this.getWithAuth("/api/bundle/latest", { workspace_id: workspaceId });
    const bundle = bundleResponse.data ?? {};
    const branchId = bundle.branchId ?? bundleResponse.headers["x-spctre-branch-id"];
    const revisionId = bundle.revisionId ?? bundleResponse.headers["x-spctre-revision-id"];
    const artifactHash = bundle.artifactHash ?? bundleResponse.headers["x-spctre-artifact-hash"];
    if (!branchId || !revisionId || !artifactHash) {
      throw new Error("Published policy bundle metadata is unavailable");
    }
    return { branchId, revisionId, artifactHash };
  }

  private mcpPolicyLoaded = false;
  private mcpPolicyCacheKey = "";

  // Merge workspace MCP policy into the env-var allowlists (union semantics).
  private mergeMcpPolicyData(data: McpPolicyData): void {
    if (Array.isArray(data.allowedTools) && data.allowedTools.length > 0) {
      const merged = new Set<string>([...(this.config.allowedTools ?? []), ...data.allowedTools]);
      this.config.allowedTools = [...merged];
    }
    if (Array.isArray(data.allowedConnectors) && data.allowedConnectors.length > 0) {
      const merged = new Set<string>([...(this.config.allowedConnectors ?? []), ...data.allowedConnectors]);
      this.config.allowedConnectors = [...merged];
    }
    if (Array.isArray(data.capabilities)) {
      this.governedMcpCapabilities = data.capabilities;
    }
    this.mcpRegistrySource = data.registry?.source ?? "api";
  }

  private async ensureMcpPolicyLoaded(options: { agentId?: string; environment?: string } = {}): Promise<void> {
    const cacheKey = `${options.agentId ?? this.config.agentId}:${options.environment ?? "production"}`;
    if (this.mcpPolicyLoaded && this.mcpPolicyCacheKey === cacheKey) return;
    this.mcpPolicyLoaded = true;
    this.mcpPolicyCacheKey = cacheKey;
    try {
      const response = await this.getWithAuth("/api/workspace/mcp-policy", {
        agentId: options.agentId ?? this.config.agentId,
        environment: options.environment ?? "production",
      });
      this.mergeMcpPolicyData(response.data ?? {});
      emitTokenEvent("mcp.policy_loaded", {
        tools: this.config.allowedTools?.length,
        connectors: this.config.allowedConnectors?.length,
        capabilities: this.governedMcpCapabilities.length,
        registry_source: this.mcpRegistrySource,
      });
    } catch {
      // Policy fetch failed — fall back to env-var allowlists only.
      this.mcpRegistrySource = "env_vars_only";
      emitTokenEvent("mcp.policy_load_failed", { fallback: "env_vars_only" });
    }
  }
}
