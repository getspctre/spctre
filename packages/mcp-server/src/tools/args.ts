// Argument types for the MCP tool handlers. These mirror the JSON Schemas
// advertised in `schemas.ts`. Handlers obtain a value of the matching type via
// `validateToolArgs` (see `validate.ts`), which checks the raw transport args
// against the same schema at runtime before returning them typed — so the type
// reflects a validated shape, not just a cast.

export interface McpAgentContext {
  agent_id?: string;
  workspace_id?: string;
  environment?: string;
}

export interface EvaluatePolicyArgs {
  connector?: string;
  action?: string;
  agent_context: McpAgentContext;
  tool_context?: {
    amount?: number;
    target?: string;
    batch_size?: number;
    raw_args?: Record<string, unknown>;
  };
  risk_level?: string;
}

export interface CreateEvidenceArgs {
  decision_id?: string;
  connector?: string;
  action?: string;
  agent_context: McpAgentContext;
  outcome?: string;
  result?: Record<string, unknown> | null;
  raw_evidence?: unknown;
  audit_seal?: unknown;
  tags?: unknown;
}

export interface EscalateToReviewArgs {
  decision_id?: string;
  reason?: string;
  priority?: string;
  assignee?: string;
}

export interface GetPolicyStatusArgs {
  workspace_id?: string;
  environment?: string;
}

export interface GetEffectivePolicyArgs {
  connector?: string;
  environment?: string;
  agent_id?: string;
}

// Metadata returned by GET /api/bundle/latest, used when composing evidence
// payloads and effective-policy responses.
export interface PublishedBundleMeta {
  tenantId?: string;
  branchId?: string;
  revisionId?: string;
  artifactHash?: string;
  rules?: Array<Record<string, unknown>>;
}
