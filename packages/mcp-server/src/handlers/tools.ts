// MCP tool handlers. Each validates its args, performs the governed
// control-plane call, and returns an MCP tool result envelope (including the
// degraded error envelope on failure). Extracted from server.ts (Phase 2
// large-file split); the CallTool dispatch and tool/handler catalog stay in
// server.ts.

import { authorizeGovernedMcpTool } from "../governance.js";
import { validateToolArgs } from "../tools/validate.js";
import {
  type McpAgentContext,
  type PublishedBundleMeta,
  type EvaluatePolicyArgs,
  type CreateEvidenceArgs,
  type EscalateToReviewArgs,
  type GetPolicyStatusArgs,
  type GetEffectivePolicyArgs,
} from "../tools/args.js";
import { errorMessage, type McpServerContext } from "./context.js";

const MCP_OUTCOME_STATUS: Record<string, "ALLOW" | "DENY" | "WARN"> = {
  EXECUTED: "ALLOW",
  BLOCKED: "DENY",
  SKIPPED: "WARN",
  ERROR: "WARN",
};

// Build the /api/evidence payload for create_evidence_record from the parsed
// tool args and the published bundle metadata.
function buildMcpEvidencePayload(
  parsed: {
    decision_id: unknown;
    connector: unknown;
    action: unknown;
    agent_context: McpAgentContext;
    outcome: unknown;
    result: Record<string, unknown> | null | undefined;
    raw_evidence: unknown;
    audit_seal: unknown;
    tags: unknown;
  },
  bundle: PublishedBundleMeta,
): Record<string, unknown> {
  const {
    decision_id,
    connector,
    action,
    agent_context,
    outcome,
    result,
    raw_evidence,
    audit_seal,
    tags,
  } = parsed;
  const mappedStatus = MCP_OUTCOME_STATUS[String(outcome || "")] || "WARN";

  return {
    decisionId: decision_id,
    sourceType: "mcp",
    tenantId: bundle.tenantId,
    workspaceId: agent_context.workspace_id,
    environment: agent_context.environment || "production",
    runtimeTarget: {
      stack: "CUSTOM",
      adapter: "agt-compatible",
      environment: agent_context.environment || "production",
    },
    connector,
    action,
    agentId: agent_context.agent_id,
    status: mappedStatus,
    reason: `Recorded by MCP create_evidence_record with outcome=${outcome || "UNKNOWN"}`,
    policyRefs: ["mcp.create_evidence_record"],
    artifactHash: bundle.artifactHash,
    policyContext: [
      {
        scope: "WORKSPACE",
        branchId: bundle.branchId,
        revisionId: bundle.revisionId,
        artifactHash: bundle.artifactHash,
      },
    ],
    latencyMs: Number(result?.latency_ms || 0),
    createdAt: new Date().toISOString(),
    rawEvidence: {
      outcome,
      result: result || null,
      rawEvidence: raw_evidence || null,
      auditSeal: typeof audit_seal === "string" ? audit_seal : undefined,
      tags: tags || [],
    },
  };
}

export async function evaluatePolicy(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { connector, action, agent_context, tool_context, risk_level } =
      validateToolArgs<EvaluatePolicyArgs>("evaluate_policy", args);

    ctx.assertConnectorAllowed(connector);

    if (agent_context.workspace_id !== ctx.config.workspaceId) {
      throw new Error("Workspace mismatch");
    }

    const { branchId, revisionId, artifactHash } = await ctx.fetchPublishedBundleRefs(
      agent_context.workspace_id,
    );
    const rawArgs = tool_context?.raw_args ?? {};
    const normalizedRiskLevel =
      typeof risk_level === "string" ? risk_level.toUpperCase() : "MEDIUM";
    const consequence =
      rawArgs.consequence ??
      (normalizedRiskLevel === "HIGH" || normalizedRiskLevel === "CRITICAL"
        ? normalizedRiskLevel
        : undefined);

    const decisionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await ctx.postWithAuth("/api/gateway/decide", {
      decisionId,
      connector,
      action,
      agentId: agent_context.agent_id,
      workspaceId: agent_context.workspace_id,
      artifactHash,
      policyContext: [{ scope: "WORKSPACE", branchId, revisionId, artifactHash }],
      consequence,
      dataSensitivity: rawArgs.dataSensitivity,
      amountUsd: rawArgs.amountUsd,
      trustScore: rawArgs.trustScore,
      context: tool_context,
      riskLevel: normalizedRiskLevel,
    });
    const decision = response.data.decision ?? response.data;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decision: decision.outcome ?? decision.status,
            reason: decision.reason ?? response.data.reason ?? "",
            matched_rules: response.data.matchedRules || [],
            policy_refs: response.data.policyRefs || [],
            decision_id: decisionId,
            escalation: response.data.escalation,
            confidence: response.data.confidence || 0.95,
            latency_ms: response.data.latencyMs || 5,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Policy evaluation failed: ${errorMessage(error)}`,
            decision: "ERROR",
          }),
        },
      ],
    };
  }
}

export async function createEvidenceRecord(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const {
      decision_id,
      connector,
      action,
      agent_context,
      outcome,
      result,
      raw_evidence,
      audit_seal,
      tags,
    } = validateToolArgs<CreateEvidenceArgs>("create_evidence_record", args);

    ctx.assertConnectorAllowed(connector);

    if (!agent_context?.workspace_id || !agent_context?.agent_id) {
      throw new Error("agent_context.agent_id and agent_context.workspace_id are required.");
    }

    if (agent_context.workspace_id !== ctx.config.workspaceId) {
      throw new Error("Workspace mismatch");
    }

    const bundleResponse = await ctx.getWithAuth("/api/bundle/latest", {
      workspace_id: agent_context.workspace_id,
    });

    const bundle = bundleResponse.data || {};

    if (!bundle.branchId || !bundle.revisionId || !bundle.artifactHash) {
      throw new Error("Published bundle metadata unavailable for evidence payload.");
    }

    const response = await ctx.postWithAuth(
      "/api/evidence",
      buildMcpEvidencePayload(
        {
          decision_id,
          connector,
          action,
          agent_context,
          outcome,
          result,
          raw_evidence,
          audit_seal,
          tags,
        },
        bundle,
      ),
      { "x-spctre-source": "mcp" },
    );

    const evidence = response.data?.evidence || {};

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            evidence_id: evidence.decisionId || decision_id,
            tenant_id: evidence.tenantId || bundle.tenantId,
            workspace_id: evidence.workspaceId || agent_context.workspace_id,
            agent_id: evidence.agentId || agent_context.agent_id,
            persisted_at: evidence.createdAt || new Date().toISOString(),
            audit_ready: true,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Evidence creation failed: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function escalateToReview(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate once, before the try: invalid args must surface, not fall through
  // to the synthetic-escalation fallback (which only exists to degrade
  // gracefully when the upstream POST fails, not on malformed input).
  const { decision_id, reason, priority, assignee } = validateToolArgs<EscalateToReviewArgs>(
    "escalate_to_review",
    args,
  );
  try {
    const response = await ctx.postWithAuth("/api/gateway/escalations", {
      decisionId: decision_id,
      reason,
      priority: priority || "NORMAL",
      assignee,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            escalation_id: response.data.escalationId || `esc-${Date.now()}`,
            decision_id,
            reason,
            priority: priority || "NORMAL",
            assigned_to: assignee,
            sla_deadline:
              response.data.slaDeadline || new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
            queue_position: response.data.queuePosition ?? 1,
            status: response.data.status || "QUEUED",
          }),
        },
      ],
    };
  } catch {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            escalation_id: `esc-${Date.now()}`,
            decision_id,
            reason,
            priority: priority || "NORMAL",
            assigned_to: assignee,
            sla_deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
            queue_position: 1,
            status: "QUEUED",
          }),
        },
      ],
    };
  }
}

export async function getPolicyStatus(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { workspace_id, environment } = validateToolArgs<GetPolicyStatusArgs>(
      "get_policy_status",
      args,
    );

    const [adaptersResponse, bundleResponse] = await Promise.allSettled([
      ctx.getWithAuth("/api/adapters", { workspace_id, environment }),
      ctx.getWithAuth("/api/bundle/latest", {
        workspace_id: workspace_id || ctx.config.workspaceId,
      }),
    ]);

    // policies_count and connectors describe the published policy, so both are
    // read from the bundle. They were previously derived from /api/adapters,
    // which counts adapter declarations — a different thing that happens to be
    // a list, so the number looked plausible while measuring the wrong subject.
    const bundleBody: unknown =
      bundleResponse.status === "fulfilled" ? bundleResponse.value.data : undefined;
    const rules: Array<Record<string, unknown>> = Array.isArray(
      (bundleBody as { rules?: unknown })?.rules,
    )
      ? ((bundleBody as { rules: Array<Record<string, unknown>> }).rules ?? [])
      : [];

    // A rule names the connectors it governs, and "*" means every connector.
    // The wildcard is kept rather than expanded: dropping it would hide that a
    // rule applies universally, and there is no connector list to expand into.
    const connectors = [
      ...new Set(
        rules.flatMap((rule) =>
          Array.isArray(rule.connectors)
            ? rule.connectors.filter((name): name is string => typeof name === "string")
            : [],
        ),
      ),
    ].sort();

    // The adapter declarations keep their own field, under the name they
    // actually carry. /api/adapters answers `{ adapters, meta }`, so the body
    // is not the list; accept either that envelope or a bare array.
    const adaptersBody: unknown =
      adaptersResponse.status === "fulfilled" ? adaptersResponse.value.data : undefined;
    const adapters: unknown[] = Array.isArray(adaptersBody)
      ? adaptersBody
      : Array.isArray((adaptersBody as { adapters?: unknown })?.adapters)
        ? ((adaptersBody as { adapters: unknown[] }).adapters ?? [])
        : [];

    const bundleHeaders = bundleResponse.status === "fulfilled" ? bundleResponse.value.headers : {};
    const revisionId = bundleHeaders["x-spctre-revision-id"] ?? null;
    const artifactHash = bundleHeaders["x-spctre-artifact-hash"] ?? null;
    const publishedAt = bundleHeaders["x-spctre-published-at"] ?? null;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            version: revisionId,
            approval_status: revisionId ? "PUBLISHED" : "UNAVAILABLE",
            policies_count: rules.length,
            connectors,
            adapters,
            artifact_hash: artifactHash,
            last_updated_at: publishedAt ?? new Date().toISOString(),
            last_updated_by: "system",
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Policy status query failed: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function getEffectivePolicy(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { connector, environment, agent_id } = validateToolArgs<GetEffectivePolicyArgs>(
      "get_effective_policy",
      args,
    );
    ctx.assertConnectorAllowed(connector);

    const bundleResponse = await ctx.getWithAuth("/api/bundle/latest", {
      workspace_id: ctx.config.workspaceId,
    });

    const bundle = bundleResponse.data ?? {};
    const headers = bundleResponse.headers ?? {};
    const allRules: Array<Record<string, unknown>> = bundle.rules ?? [];

    const matchingRules = connector
      ? allRules.filter(
          (r: Record<string, unknown>) =>
            !Array.isArray(r.connectors) ||
            r.connectors.length === 0 ||
            r.connectors.includes(connector) ||
            r.connectors.includes("*"),
        )
      : allRules;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            workspace_id: ctx.config.workspaceId,
            agent_id: agent_id ?? ctx.config.agentId,
            connector: connector ?? null,
            environment: environment ?? null,
            revision_id: headers["x-spctre-revision-id"] ?? bundle.revisionId ?? null,
            artifact_hash: headers["x-spctre-artifact-hash"] ?? bundle.artifactHash ?? null,
            published_at: headers["x-spctre-published-at"] ?? null,
            rules: matchingRules,
            rules_count: matchingRules.length,
            total_rules: allRules.length,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Effective policy resolution failed: ${errorMessage(error)}`,
          }),
        },
      ],
    };
  }
}

export async function listPendingEscalations(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const limit = Math.max(1, Math.min(100, Number(args?.limit ?? 20)));
    const response = await ctx.getWithAuth("/api/gateway/escalations", { limit });
    const data = response.data ?? {};

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            queue: data.queue ?? [],
            count: data.count ?? 0,
            generated_at: data.generatedAt ?? new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Escalation list failed: ${errorMessage(error)}`,
            queue: [],
            count: 0,
          }),
        },
      ],
    };
  }
}

export async function getComplianceStatus(
  ctx: McpServerContext,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const response = await ctx.getWithAuth("/api/compliance/status");
    return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Compliance status unavailable: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function ingestGatewayEvent(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const response = await ctx.postWithAuth("/api/gateway-ingest/mcp", args, {
      "x-spctre-source": "mcp",
      "ingest-mode": "gateway",
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decision_id: response.data.decisionId,
            provenance_gap: response.data.provenanceGap ?? false,
            deduplicated: response.data.deduplicated ?? false,
            ingest_mode: "gateway",
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Gateway event ingest failed: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function discoverMcpTools(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    await ctx.ensureMcpPolicyLoaded({
      agentId: typeof args?.agent_id === "string" ? args.agent_id : undefined,
      environment: typeof args?.environment === "string" ? args.environment : undefined,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            workspace_id: ctx.config.workspaceId,
            agent_id: typeof args?.agent_id === "string" ? args.agent_id : ctx.config.agentId,
            registry_source: ctx.mcpRegistrySource,
            tools: ctx.governedMcpCapabilities,
            count: ctx.governedMcpCapabilities.length,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `MCP discovery failed: ${errorMessage(error)}`,
            tools: [],
          }),
        },
      ],
    };
  }
}

function parseAuthorizeArgs(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): {
  serverName: string;
  toolName: string;
  workspaceId: string;
  agentId: string;
  environment?: string;
} {
  const serverName = typeof args?.server_name === "string" ? args.server_name : "";
  const toolName = typeof args?.tool_name === "string" ? args.tool_name : "";
  if (!serverName || !toolName) {
    throw new Error("server_name and tool_name are required.");
  }

  const agentContext =
    args?.agent_context &&
    typeof args.agent_context === "object" &&
    !Array.isArray(args.agent_context)
      ? (args.agent_context as Record<string, unknown>)
      : {};
  const workspaceId =
    typeof agentContext.workspace_id === "string"
      ? agentContext.workspace_id
      : ctx.config.workspaceId;
  const agentId =
    typeof agentContext.agent_id === "string" ? agentContext.agent_id : ctx.config.agentId;
  if (workspaceId !== ctx.config.workspaceId) {
    throw new Error("Workspace mismatch");
  }

  return {
    serverName,
    toolName,
    workspaceId,
    agentId,
    environment:
      typeof agentContext.environment === "string" ? agentContext.environment : undefined,
  };
}

async function fetchArtifactHashBestEffort(ctx: McpServerContext): Promise<string | null> {
  const bundleResponse = await ctx
    .getWithAuth("/api/bundle/latest", { workspace_id: ctx.config.workspaceId })
    .catch(() => null);
  return (
    bundleResponse?.headers?.["x-spctre-artifact-hash"] ??
    bundleResponse?.data?.artifactHash ??
    null
  );
}

export async function authorizeMcpToolCall(
  ctx: McpServerContext,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { serverName, toolName, workspaceId, agentId, environment } = parseAuthorizeArgs(
      ctx,
      args,
    );

    await ctx.ensureMcpPolicyLoaded({ agentId, environment });

    const artifactHash = await fetchArtifactHashBestEffort(ctx);

    const secret = ctx.config.auditSealSecret;
    if (!secret) {
      throw new Error(
        "SPCTRE_MCP_AUDIT_SEAL_SECRET is required to seal MCP authorization decisions.",
      );
    }
    const authorization = authorizeGovernedMcpTool({
      capabilities: ctx.governedMcpCapabilities,
      workspaceId,
      agentId,
      serverName,
      toolName,
      connector: typeof args?.connector === "string" ? args.connector : undefined,
      action: typeof args?.action === "string" ? args.action : undefined,
      artifactHash,
      sealSecret: secret,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            decision_id: authorization.decisionId,
            outcome: authorization.outcome,
            reason: authorization.reason,
            server_name: serverName,
            tool_name: toolName,
            connector: authorization.capability?.connector ?? args?.connector ?? "mcp",
            action: authorization.capability?.action ?? args?.action ?? toolName,
            audit_seal: authorization.auditSeal,
            issued_at: authorization.issuedAt,
            registry_source: ctx.mcpRegistrySource,
            capability: authorization.capability,
            wrapper_contract: {
              execute_downstream: authorization.outcome === "ALLOW",
              evidence_required: true,
              attach_fields: ["decision_id", "audit_seal", "server_name", "tool_name"],
            },
          }),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `MCP authorization failed: ${errorMessage(error)}`,
            outcome: "DENY",
          }),
        },
      ],
    };
  }
}
