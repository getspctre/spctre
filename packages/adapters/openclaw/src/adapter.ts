import { randomUUID } from "node:crypto";
import { SpctreClient } from "./client.js";
import type {
  BeforeToolCallHook,
  BeforeToolCallResult,
  EvaluationResult,
  EvaluateParams,
  EvidenceRecord,
  ExecutionContext,
  TriggerKind,
} from "./types.js";

export interface SpctreOpenClawAdapterOptions {
  apiKey: string;
  baseUrl: string;
  agentId: string;
  tenantId: string;
  workspaceId: string;
  environment?: string;
  timeout?: number;
  dryRun?: boolean;
}

export class SpctreOpenClawAdapter {
  private readonly client: SpctreClient;
  private readonly agentId: string;
  private readonly tenantId: string;
  private readonly workspaceId: string;
  private readonly environment: string;
  private readonly dryRun: boolean;

  constructor(options: SpctreOpenClawAdapterOptions) {
    this.agentId = options.agentId;
    this.tenantId = options.tenantId;
    this.workspaceId = options.workspaceId;
    this.environment = options.environment ?? "production";
    this.dryRun = options.dryRun ?? false;
    this.client = new SpctreClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      timeout: options.timeout ?? 5000,
    });
  }

  register(runtime: { runBeforeToolCallHook: (fn: BeforeToolCallHook) => void }): void {
    runtime.runBeforeToolCallHook(this.beforeToolCall);
  }

  beforeToolCall: BeforeToolCallHook = async (
    toolName: string,
    args: Record<string, unknown>,
    hookContext: Record<string, unknown>
  ): Promise<BeforeToolCallResult> => {
    if (this.dryRun) {
      return { action: "allow" };
    }

    const startedAt = Date.now();
    const evaluationInput = buildEvaluationInput(toolName, args, hookContext);
    const evaluation = await this.client.evaluate(evaluationInput);
    const evidence = this.buildEvidenceRecord({
      toolName,
      args,
      hookContext,
      evaluationInput,
      evaluation,
      latencyMs: Date.now() - startedAt,
    });

    const decision = decisionFromEvaluation(evaluation);

    void this.client.ingestEvidence(evidence).catch((err: unknown) => {
      console.error("[spctre/openclaw] evidence emission failed:", err);
    });

    return decision;
  };

  private buildEvidenceRecord(params: {
    toolName: string;
    args: Record<string, unknown>;
    hookContext: Record<string, unknown>;
    evaluationInput: EvaluateParams;
    evaluation: EvaluationResult;
    latencyMs: number;
  }): EvidenceRecord {
    return {
      decisionId: stringFromContext(params.hookContext, ["decisionId", "decision_id"]) ?? `openclaw-${randomUUID()}`,
      tenantId: this.tenantId,
      workspaceId: this.workspaceId,
      environment: this.environment,
      runtimeTarget: {
        stack: "OPENCLAW",
        adapter: "@spctre/openclaw",
        environment: this.environment,
      },
      agentId: stringFromContext(params.hookContext, ["agentId", "agent_id"]) ?? this.agentId,
      connector: params.evaluationInput.connector,
      action: params.evaluationInput.action,
      status: params.evaluation.status,
      reason: params.evaluation.reason,
      policyRefs: params.evaluation.matchedRefs?.length ? params.evaluation.matchedRefs : undefined,
      artifactHash: params.evaluation.artifactHash,
      latencyMs: params.latencyMs,
      createdAt: new Date().toISOString(),
      rawEvidence: {
        source: "openclaw.before_tool_call",
        toolName: params.toolName,
        hookContext: params.hookContext,
      },
      triggerKind: deriveTriggerKind(params.hookContext),
      executionContext: buildExecutionContext(params.hookContext),
      parentAgentId: stringFromContext(params.hookContext, ["parentAgentId", "parent_agent_id", "routingParentAgentId", "routing_parent_agent_id"]),
      traceId: stringFromContext(params.hookContext, ["traceId", "trace_id", "sessionId", "session_id"]),
      toolParameters: params.args,
      ingestMode: "gateway",
    };
  }
}

function decisionFromEvaluation(evaluation: EvaluationResult): BeforeToolCallResult {
  if (evaluation.status === "DENY") {
    return { action: "block", reason: evaluation.reason ?? "Denied by policy." };
  }

  if (evaluation.status === "ESCALATE") {
    return { action: "block", reason: evaluation.reason ?? "Escalated for review." };
  }

  return { action: "allow" };
}

function buildEvaluationInput(
  toolName: string,
  args: Record<string, unknown>,
  hookContext: Record<string, unknown>
): EvaluateParams {
  return {
    connector: stringFromContext(hookContext, ["connector"]) ?? inferConnector(toolName, hookContext),
    action: stringFromContext(hookContext, ["action"]) ?? toolName,
    domains: arrayOfStringsFromContext(hookContext, "domains"),
    toolIntent: stringFromContext(hookContext, ["toolIntent", "tool_intent", "intent"]),
    planSummary: stringFromContext(hookContext, ["planSummary", "plan_summary"]),
    toolParameters: args,
  };
}

function inferConnector(toolName: string, hookContext: Record<string, unknown>): string {
  const executorKind = stringFromContext(hookContext, ["executorKind", "executor_kind"]);
  if (executorKind === "mcp" && toolName.includes("__")) {
    return toolName.split("__")[0] || "mcp";
  }

  if (executorKind === "channel") {
    return stringFromContext(hookContext, ["channel"]) ?? "channel";
  }

  return "openclaw";
}

function deriveTriggerKind(hookContext: Record<string, unknown>): TriggerKind {
  if (hookContext.cron === true || hookContext.scheduled === true || stringFromContext(hookContext, ["triggerKind", "trigger_kind"]) === "scheduled") {
    return "scheduled";
  }

  if (typeof hookContext.channel === "string" || stringFromContext(hookContext, ["triggerKind", "trigger_kind"]) === "gateway_message") {
    return "gateway_message";
  }

  return "interactive";
}

function buildExecutionContext(hookContext: Record<string, unknown>): ExecutionContext | undefined {
  const executionContext = recordFromContext(hookContext, "executionContext") ?? recordFromContext(hookContext, "execution_context");
  const context: ExecutionContext = {
    ...(executionContext ?? {}),
  };

  for (const [sourceKey, targetKey] of [
    ["backend", "backend"],
    ["sessionId", "sessionId"],
    ["session_id", "sessionId"],
    ["workspacePath", "workspacePath"],
    ["workspace_path", "workspacePath"],
    ["sandboxName", "sandboxName"],
    ["sandbox_name", "sandboxName"],
    ["executorKind", "executorKind"],
    ["executor_kind", "executorKind"],
    ["channel", "channel"],
  ] as const) {
    const value = hookContext[sourceKey];
    if (typeof value === "string") {
      context[targetKey] = value;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function stringFromContext(context: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = context[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function arrayOfStringsFromContext(context: Record<string, unknown>, key: string): string[] | undefined {
  const value = context[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function recordFromContext(context: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = context[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
