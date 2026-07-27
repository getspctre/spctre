export type RuntimeDecisionStatus = "ALLOW" | "DENY" | "WARN" | "ESCALATE";

export type TriggerKind =
  | "interactive"
  | "scheduled"
  | "gateway_message"
  | "mobile_dispatch"
  | "inbound_webhook"
  | "routine";

export interface RuntimeTarget {
  stack: "OPENCLAW";
  adapter: string;
  environment: string;
}

export interface ExecutionContext {
  backend?: string;
  sessionId?: string;
  workspacePath?: string;
  sandboxName?: string;
  executorKind?: "core" | "plugin" | "channel" | "mcp" | string;
  channel?: string;
  [key: string]: unknown;
}

interface EvaluationTraceStep {
  stableRuleId: string;
  title: string;
  effect: RuntimeDecisionStatus;
  matched: boolean;
  matchReason: string;
}

export interface EvaluationResult {
  status: RuntimeDecisionStatus;
  reason: string;
  matchedRefs?: string[];
  trace?: EvaluationTraceStep[];
  ruleCount?: number;
  evaluatedAt?: string;
  artifactHash?: string;
  branchId?: string;
  revisionId?: string;
}

export interface EvidenceRecord {
  decisionId: string;
  tenantId: string;
  workspaceId: string;
  environment: string;
  runtimeTarget: RuntimeTarget;
  agentId: string;
  connector: string;
  action: string;
  status: RuntimeDecisionStatus;
  reason: string;
  policyRefs?: string[];
  artifactHash?: string;
  latencyMs?: number;
  createdAt: string;
  rawEvidence?: Record<string, unknown>;
  triggerKind?: TriggerKind;
  executionContext?: ExecutionContext;
  parentAgentId?: string;
  traceId?: string;
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  ingestMode?: "gateway" | "standard";
}

export interface EvaluateParams {
  connector: string;
  action: string;
  domains?: string[];
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
}

export type BeforeToolCallResult =
  | { action: "allow" }
  | { action: "block"; reason: string };

export type BeforeToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  hookContext: Record<string, unknown>
) => Promise<BeforeToolCallResult>;
