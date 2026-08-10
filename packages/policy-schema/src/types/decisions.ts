export type RuntimeStack =
  | "AWS_BEDROCK"
  | "GOOGLE_ADK"
  | "AZURE_AI"
  | "LANGCHAIN"
  | "LANGGRAPH"
  | "CREWAI"
  | "AUTOGEN"
  | "OPENAI_AGENTS"
  | "OMNIGENT"
  | "OPENCODE"
  | "CLAUDE_CODE"
  | "HERMES"
  | "OPENCLAW"
  | "NEMOCLAW"
  | "CLAUDE_COWORK"
  | "ODYSSEUS"
  | "PAPERCLIP"
  | "LOCAL"
  | "CUSTOM";

export type TriggerKind =
  | "interactive"
  | "scheduled"
  | "mobile_dispatch"
  | "inbound_webhook"
  | "routine"
  | "gateway_message";

export type EvidenceLayer = "agent" | "sandbox";

export type RuntimeDecisionStatus = "ALLOW" | "DENY" | "WARN" | "ESCALATE";

export interface RuntimeTarget {
  stack: RuntimeStack;
  adapter?: string;
  environment?: string;
  sandboxName?: string;
  inferenceProvider?: string;
}

export interface RuntimeEvidenceSearchQuery {
  text?: string;
  statuses?: RuntimeDecisionStatus[];
  runtimeStacks?: RuntimeStack[];
  connectors?: string[];
  triggerKinds?: TriggerKind[];
  layers?: EvidenceLayer[];
  sandboxNames?: string[];
  inferenceProviders?: string[];
  trustLevels?: string[];
  pluginSources?: string[];
  skillIds?: string[];
  companyIds?: string[];
  branchId?: string;
  revisionId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface PolicyRuleDiagnostic {
  ruleId?: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
}

export interface EvaluationTraceStep {
  stableRuleId: string;
  title: string;
  effect: RuntimeDecisionStatus;
  matched: boolean;
  matchReason: string;
}

export interface EvaluationResult {
  status: RuntimeDecisionStatus;
  matchedRefs: string[];
  reason: string;
  trace: EvaluationTraceStep[];
  ruleCount: number;
  evaluatedAt: string;

  // Deterministic provenance every implementation returns, per
  // PUBLISHED_EVALUATOR_CONTRACT.md. Optional here only because a caller may
  // hold a result recorded before these were surfaced to TypeScript.
  evaluatorVersion?: string;
  requestSchemaVersion?: string;
  resultSchemaVersion?: string;
  policyArtifactHash?: string | null;
}
