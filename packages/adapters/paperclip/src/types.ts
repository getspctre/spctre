type RuntimeDecisionStatus = "ALLOW" | "DENY" | "WARN" | "ESCALATE";

export type TriggerKind = "interactive" | "routine" | "scheduled";

export type TrustLevel = "high" | "standard" | "low" | "untrusted";

export interface OrchestratorRef {
  platform: "paperclip";
  companyId?: string;
  issueId?: string;
  goalId?: string;
}

/**
 * Subset of RuntimeDecisionEvidenceRecord fields relevant to Paperclip.
 * Depends on polly/schema-ts-additions for PAPERCLIP RuntimeStack,
 * orchestratorRef, and trustLevel additions to the canonical type.
 */
export interface PaperclipEvidenceRecord {
  decisionId: string;
  workspaceId: string;
  tenantId: string;
  agentId: string;
  parentAgentId?: string;
  connector: string;
  action: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  runtimeTarget: {
    stack: "PAPERCLIP";
    adapter: string;
    environment?: string;
  };
  orchestratorRef: OrchestratorRef;
  trustLevel: TrustLevel;
  triggerKind: TriggerKind;
  status: RuntimeDecisionStatus;
  reason?: string;
  decidedAt: string;
  rawEvidence?: Record<string, unknown>;
  ingestMode?: "gateway" | "standard";
}

export interface HeartbeatPayload {
  agentId: string;
  companyId?: string;
  issueId?: string;
  goalId?: string;
  runStatus: string;
  taskContext?: Record<string, unknown>;
  timestamp?: string;
}

export interface DispatchContext {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  agentId?: string;
  parentAgentId?: string;
  companyId?: string;
  issueId?: string;
  goalId?: string;
  /**
   * Trust preset assigned by Paperclip's trust-preset-resolver.ts.
   * Written to trustLevel on evidence records so operators can write
   * Spctre policy rules conditioned on trustLevel == "low".
   */
  trustPreset?: TrustLevel;
  /**
   * True when this dispatch originates from a Paperclip routine (scheduled
   * task), not an interactive agent session.
   */
  isRoutine?: boolean;
  environment?: string;
  rawContext?: Record<string, unknown>;
}

export interface DispatchResult {
  action: "allow" | "deny" | "warn";
  reason?: string;
  decisionId?: string;
}

export type BeforeToolDispatchHook = (
  context: DispatchContext
) => Promise<DispatchResult>;

export interface SpctrePaperclipPluginOptions {
  apiKey: string;
  baseUrl: string;
  agentId: string;
  tenantId: string;
  workspaceId: string;
  environment?: string;
  dryRun?: boolean;
}
