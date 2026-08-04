import type { RuntimeStack } from "./decisions";

export interface AdapterCapabilityDeclaration {
  id: string;
  stack: RuntimeStack;
  adapterId: string;
  adapterVersion?: string;
  environment?: string;
  supportedConnectors: string[];
  capabilities: Record<string, unknown>;
  registeredAt: string;
  registeredBy: string;
}

export interface BundleCompatibilityGap {
  adapterId: string;
  stack: RuntimeStack;
  environment?: string;
  uncoveredConnectors: string[];
  severity: "ERROR" | "WARNING";
}

export interface BundleCompatibilityReport {
  compatible: boolean;
  adapterCount: number;
  coveredConnectors: string[];
  uncoveredConnectors: string[];
  gaps: BundleCompatibilityGap[];
}

export type TrustScoreSource =
  "EVIDENCE_INGEST" | "POLICY_EVALUATION" | "MANUAL" | "IDENTITY_EVENT" | "SYSTEM";

export interface TrustScoreEvent {
  id: string;
  tenantId: string;
  workspaceId: string;
  agentId: string;
  environment: string;
  runtimeStack: RuntimeStack;
  trustScore: number;
  previousScore?: number;
  delta?: number;
  source: TrustScoreSource;
  sourceRef?: string;
  reason?: string;
  createdAt: string;
}

export type IdentityLifecycleEventType =
  | "CREATED"
  | "UPDATED"
  | "DELETED"
  | "CREDENTIAL_ADDED"
  | "CREDENTIAL_REMOVED"
  | "MFA_ENROLLED"
  | "MFA_REVOKED"
  | "SSO_LINKED"
  | "SSO_UNLINKED"
  | "ROLE_GRANTED"
  | "ROLE_REVOKED"
  | "SESSION_REVOKED"
  | "TOKEN_ISSUED"
  | "TOKEN_REVOKED"
  | "SURFACE_LINKED"
  | "SURFACE_UNLINKED";

export type IdentityEventSource = "OIDC" | "SAML" | "LOCAL" | "API" | "ADMIN" | "SYSTEM";

export interface IdentityLifecycleEvent {
  id: string;
  tenantId: string;
  workspaceId?: string;
  principalId: string;
  eventType: IdentityLifecycleEventType;
  actorId: string;
  source: IdentityEventSource;
  detail: Record<string, unknown>;
  agentDid?: string;
  signatureAlgorithm?: "Ed25519" | string;
  signatureKeyId?: string;
  payloadHash?: string;
  signature?: string;
  signatureVerificationOutcome?: "PASS" | "FAIL" | "WARN";
  signatureFailureReason?: string;
  signatureVerifiedAt?: string;
  createdAt: string;
}

export interface TrustCalibrationPolicy {
  id: string;
  tenantId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  agentClass?: string;
  environment?: string;
  connector?: string;
  consequenceTier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  decayEnabled: boolean;
  decayRate?: number;
  decayPeriodHours?: number;
  decayFloor?: number;
  warnThreshold?: number;
  escalateThreshold?: number;
  reviewThreshold?: number;
  contextWarnThreshold?: number;
  contextEscalateThreshold?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ContextBudgetEventType =
  "TOKEN_GROWTH" | "SUMMARIZATION_EVENT" | "CONTEXT_SOURCE_MIX" | "BUDGET_BREACH";

export interface ContextBudgetEvent {
  id: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  agentId: string;
  environment: string;
  runtimeStack: RuntimeStack;
  eventType: ContextBudgetEventType;
  tokenCount: number;
  tokenDelta?: number;
  contextSourceMix: { system?: number; user?: number; assistant?: number; tool?: number };
  budgetLimit?: number;
  budgetUtilization?: number;
  governanceAction?: "ALLOW" | "WARN" | "ESCALATE" | "REVIEW";
  policyRef?: string;
  createdAt: string;
}

export type AgentSurfaceType = string;

export interface AgentSurfaceBinding {
  id: string;
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  surfaceType: AgentSurfaceType;
  surfaceAgentId: string;
  createdBy: string;
  createdAt: string;
}

export interface CrossSurfaceTrustSummary {
  canonicalAgentId: string;
  surfaces: AgentSurfaceBinding[];
  history: TrustScoreEvent[];
  latestScore?: number;
  surfaceCount: number;
}

/**
 * The kind of correlated event on a canonical agent's unified cross-surface
 * timeline. Each maps to a distinct durable record type already persisted by
 * the control plane; the timeline joins them by canonical identity.
 */
export type CrossSurfaceEventKind = "DECISION" | "TRUST" | "IDENTITY" | "REVIEW";

/**
 * One event on a canonical agent's unified cross-surface history. It preserves
 * the runtime-local surface the event originated from so reviewers can see
 * identity provenance across MCP, gateways, CLI adapters, and framework
 * integrations without collapsing the surface distinction.
 */
export interface CrossSurfaceIdentityEvent {
  kind: CrossSurfaceEventKind;
  /** ISO timestamp; the unified sort key across all sources. */
  at: string;
  /** The runtime-local agent identity this event was recorded against. */
  surfaceAgentId: string;
  /** Resolved surface type for a bound surface; undefined for canonical-native events. */
  surfaceType?: AgentSurfaceType;
  /** Short human-readable label for the event. */
  summary: string;
  /** Decision/review outcome or event subtype, when applicable. */
  status?: string;
  connector?: string;
  action?: string;
  /** Source record identifier (decisionId, trust event id, queue id, lifecycle event id). */
  ref?: string;
  detail?: Record<string, unknown>;
}

export interface CrossSurfaceIdentityHistory {
  canonicalAgentId: string;
  surfaces: AgentSurfaceBinding[];
  surfaceCount: number;
  events: CrossSurfaceIdentityEvent[];
  counts: { decisions: number; trust: number; identity: number; reviews: number };
  latestTrustScore?: number;
  generatedAt?: string;
}

export type TrustGovernanceAction = "ALLOW" | "WARN" | "ESCALATE" | "REVIEW";

export interface TrustGovernanceResult {
  action: TrustGovernanceAction;
  reason: string;
  matchedPolicyId?: string;
  matchedPolicyName?: string;
  trustScore?: number;
  contextTokens?: number;
  budgetUtilization?: number;
  recommendedRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evaluatedAt: string;
}
