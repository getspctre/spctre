import type { RuntimePolicyContext } from "./policy";

export type GatewayDecisionOutcome = "PROCEED" | "ESCALATE" | "ABORT";
export type GatewayEscalationStatus = "PENDING" | "IN_REVIEW" | "RESOLVED" | "EXPIRED";

export interface GatewayDecisionContextInput {
  consequence?: string;
  customerTier?: string;
  confidence?: number;
  amountUsd?: number;
  dataSensitivity?: string;
  trustScore?: number;
  contextBudget?: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  /** Hash-only loop/payload safeguard evaluation retained with the decision. */
  safeguardTelemetry?: Record<string, unknown>;
}

export interface GatewayDecisionInput extends GatewayDecisionContextInput {
  decisionId: string;
  artifactHash: string;
  policyContext: RuntimePolicyContext[];
  reason?: string;
  agentId?: string;
  /** Stable runtime session identifier for policy-bound loop safeguards. */
  sessionId?: string;
  connector?: string;
  action?: string;
}

export interface GatewayDecision {
  id: string;
  tenantId: string;
  workspaceId: string;
  decisionId: string;
  revisionId?: string;
  branchId?: string;
  artifactHash: string;
  outcome: GatewayDecisionOutcome;
  reason: string;
  consequence?: string;
  customerTier?: string;
  confidence?: number;
  amountUsd?: number;
  dataSensitivity?: string;
  trustScore?: number;
  contextBudget?: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evaluatedBy: string;
  evaluatedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface GatewayEscalationQueueItem {
  id: string;
  tenantId: string;
  workspaceId: string;
  gatewayDecisionId: string;
  decisionId: string;
  revisionId?: string;
  artifactHash: string;
  status: GatewayEscalationStatus;
  assignedTo?: string;
  slaDueAt: string;
  handoffNotes?: string;
  resolvedAt?: string;
  resolutionOutcome?: GatewayDecisionOutcome;
  resolutionNote?: string;
  connector?: string;
  action?: string;
  consequence?: string;
  customerTier?: string;
  confidence?: number;
  amountUsd?: number;
  dataSensitivity?: string;
  trustScore?: number;
  contextBudget?: number;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  gatewayReason?: string;
  /** Runtime agent identity retained from the originating gateway decision. */
  agentId?: string;
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  /** Hash-only loop/payload safeguard evaluation retained with the decision. */
  safeguardTelemetry?: Record<string, unknown>;
  agentGuidance?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayDecisionResult {
  outcome: GatewayDecisionOutcome;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  shouldQueue: boolean;
  slaHours?: number;
}
