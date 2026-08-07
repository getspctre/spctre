import type { RuntimeDecisionStatus, RuntimeStack } from "./decisions";
import type {
  PolicyArtifactExport,
  PolicyApproval,
  ApprovalWorkflowSnapshot,
  RuntimeDecisionEvidenceRecord,
  SimulationRun,
  AgtCompatiblePolicyBundle,
} from "./policy";

export interface PolicyTimelineEvent {
  id: string;
  kind:
    | "IMPORT"
    | "APPROVAL"
    | "EXPORT"
    | "EVIDENCE"
    | "COMPOSE"
    | "DIFF"
    | "SIMULATION"
    | "ESCALATION";
  branchId: string;
  revisionId: string;
  title: string;
  detail: string;
  actor?: string;
  status: string;
  artifactHash?: string;
  sourceId: string;
  createdAt: string;
}

export interface PolicyBranchTimeline {
  branchId: string;
  revisionId: string;
  events: PolicyTimelineEvent[];
  firstEventAt?: string;
  latestEventAt?: string;
}

export type AgtVerificationType =
  | "AGT_VERIFY"
  | "AGT_VERIFY_EVIDENCE"
  | "AGT_LINT_POLICY"
  | "AGT_REDTEAM"
  | "AGT_REPLAY"
  | "CUSTOM";

export type AgtVerificationOutcome = "PASS" | "FAIL" | "WARN";

export interface AgtVerificationSummary {
  hasResults: boolean;
  overallOutcome: "PASS" | "FAIL" | "WARN" | "UNKNOWN";
  isStale: boolean;
  /** Why the most recent result cannot be used for the requested provenance. */
  staleReasons?: Array<"AGE" | "VERIFIER_LOCK" | "POLICY_CONTENT">;
  staleThresholdDays: number;
  latestRunAt: string | null;
  latestAgtVersion?: string;
  latestAgtPoliciesVersion?: string;
  latestCedarPolicyVersion?: string;
  latestPolicyEngineVersion?: string;
  compatibilityCheckedAt?: string;
  compatibilityCheckOutcome?: "PASS" | "FAIL" | "WARN";
  resultsByType: Partial<
    Record<AgtVerificationType, { outcome: AgtVerificationOutcome; createdAt: string }>
  >;
}

export interface PublishBlocker {
  message: string;
  href?: string;
  cta?: string;
}

export interface PublishReadiness {
  branchId: string;
  revisionId: string;
  isReady: boolean;
  status: "READY" | "PENDING" | "BLOCKED";
  satisfiedRoles: string[];
  missingRoles: string[];
  blockingReasons: PublishBlocker[];
  approvals: PolicyApproval[];
  verificationStatus?: AgtVerificationSummary;
  approvalWorkflow?: ApprovalWorkflowSnapshot;
}

export interface PolicyComplianceEvidenceExport {
  id: string;
  artifact: PolicyArtifactExport;
  readiness: PublishReadiness;
  timeline: PolicyBranchTimeline;
  evidence: RuntimeDecisionEvidenceRecord[];
  simulationRun?: SimulationRun;
  generatedAt: string;
  retentionDays: number;
  retentionUntil?: string;
  evidenceCount: number;
  approvalCount: number;
  policyRefCount: number;
  timelineEventCount: number;
  artifactHash: string;
  verifierLockDigest?: string;
  policyContentHash?: string;
  simulationEventCount: number;
  packageSections: string[];
  deniedDecisionCount: number;
  warnedDecisionCount: number;
  /** Rule-to-control provenance for external evidence consumers. */
  controlMappings?: Array<
    PolicyControlMapping & { stableRuleId: string; effect: RuntimeDecisionStatus }
  >;
  escalationDecisionCount?: number;
}

/** Bounded, destination-neutral hand-off request for an external GRC consumer. */
export interface GrcEvidenceBridgeDelivery {
  schemaVersion: "spctre.grc-evidence-delivery.v1";
  destination: { kind: "webhook"; endpoint: string };
  idempotencyKey: string;
  payload: {
    schemaVersion: "spctre.grc-evidence-bridge.v1";
    generatedAt: string;
    provenance: { artifactHash: string; branchId: string; revisionId: string };
    evidence: {
      packageId: string;
      evidenceCount: number;
      deniedDecisionCount: number;
      warnedDecisionCount: number;
      controlMappings: Array<
        PolicyControlMapping & { stableRuleId: string; effect: RuntimeDecisionStatus }
      >;
    };
  };
}

export interface EvidenceRetentionRule {
  id: string;
  label: string;
  retentionDays: number;
  appliesTo: {
    statuses?: RuntimeDecisionStatus[];
    environments?: string[];
    runtimeStacks?: RuntimeStack[];
  };
  exportable: boolean;
}

export interface RetentionDecision {
  decisionId: string;
  connector: string;
  environment: string;
  runtimeStack: RuntimeStack;
  disposition: "ACTIVE" | "EXPIRING" | "EXPIRED";
  retentionLabel: string;
  retainUntil: string;
  daysRemaining: number;
  exportable: boolean;
}

export interface EvidenceRetentionPlan {
  id: string;
  evidence: RuntimeDecisionEvidenceRecord[];
  rules: EvidenceRetentionRule[];
  generatedAt: string;
  expiringWithinDays: number;
  activeCount: number;
  expiringCount: number;
  expiredCount: number;
  exportableCount: number;
  longestRetentionDays: number;
  decisions: RetentionDecision[];
}

export type ComplianceFramework =
  | "soc2"
  | "iso27001"
  | "hipaa"
  | "gdpr"
  | "pci-dss"
  | "nist-ai-rmf"
  | "public-sector"
  | "eu-ai-act";

export interface ComplianceControl {
  controlId: string;
  controlName: string;
  status: "ADDRESSED" | "PARTIAL" | "NOT_APPLICABLE";
  evidence: string[];
  notes?: string;
}

export interface ComplianceFrameworkAnnotation {
  framework: ComplianceFramework;
  frameworkLabel: string;
  generatedAt: string;
  controls: ComplianceControl[];
  summary: { addressedCount: number; partialCount: number; notApplicableCount: number };
}

export interface AgtVerificationResult {
  id: string;
  tenantId: string;
  workspaceId: string;
  revisionId?: string;
  artifactHash: string;
  verifierLockDigest?: string;
  policyContentHash?: string;
  verificationType: AgtVerificationType;
  outcome: AgtVerificationOutcome;
  summary: Record<string, unknown>;
  runBy: string;
  runtimeVersion?: string;
  createdAt: string;
  // AGT v4.0.0 additive tamper-evidence fields (spec §4.3.1 — OPTIONAL in v1.0)
  argumentsHash?: string;
  approverDid?: string;
  policyVersion?: string;
  issuedAt?: string;
  completedAt?: string;
  // AGT v4.1.0 policy-engine provenance and ProofOfOutcome escrow signature fields.
  agtVersion?: string;
  agtPoliciesVersion?: string;
  cedarPolicyVersion?: string;
  policyEngineVersion?: string;
  compatibilityCheckedAt?: string;
  compatibilityCheckOutcome?: "PASS" | "FAIL" | "WARN";
  escrowSignerId?: string;
  escrowKeyId?: string;
  outcomeHash?: string;
  escrowSignature?: string;
  escrowVerificationOutcome?: "PASS" | "FAIL" | "WARN";
  escrowVerifiedAt?: string;
}

export type OperationsLogEventType =
  | "POLICY_IMPORT"
  | "POLICY_PUBLISH"
  | "POLICY_APPROVE"
  | "BLUEPRINT_APPROVE"
  | "BLUEPRINT_PUBLISH"
  | "BLUEPRINT_ROLLBACK"
  | "EVIDENCE_INGEST"
  | "EVIDENCE_EXPORT"
  | "BUNDLE_EXPORT"
  | "EVIDENCE_PRUNE"
  | "EVIDENCE_ERASURE"
  | "SIMULATION_RUN"
  | "TRUST_SCORE_CHANGE"
  | "TRUST_POLICY_BREACH"
  | "CONTEXT_BUDGET_BREACH"
  /** @deprecated Economic governance removed 2026-07-20; retained for historical evidence reads. */
  | "ECONOMIC_BUDGET_BREACH"
  /** @deprecated Economic governance removed 2026-07-20; retained for historical evidence reads. */
  | "ECONOMIC_USAGE_INGEST"
  | "IDENTITY_CHANGE"
  | "TOKEN_ISSUED"
  | "TOKEN_REVOKED"
  | "TOKEN_REFRESHED"
  | "ESCALATION_OPENED"
  | "ESCALATION_CLAIMED"
  | "ESCALATION_RESOLVED"
  /** @deprecated Advisor workflows were retired; retained for historical evidence reads. */
  | "AGENT_TRIAGE"
  /** @deprecated Advisor workflows were retired; retained for historical evidence reads. */
  | "AGENT_RECOMMENDATION"
  | "SIMULATION_GUIDANCE"
  | "GRC_DESTINATION_CONFIGURED"
  | "NOTIFICATION_SENT"
  | "NOTIFICATION_FAILED"
  | "VERIFICATION_RUN"
  | "ACTION_RECEIPT_ISSUED"
  | "COMPLIANCE_EXPORT";

export interface OperationsLogEntry {
  id: string;
  tenantId: string;
  workspaceId?: string;
  eventType: OperationsLogEventType;
  sourceId?: string;
  sourceTable?: string;
  actorId: string;
  payload: Record<string, unknown>;
  contentHash: string;
  prevHash?: string;
  createdAt: string;
}

export interface OperationsLogChainVerification {
  verified: boolean;
  totalEntries: number;
  brokenAt?: string;
  brokenEntryId?: string;
  checkedAt: string;
}

export interface AgtVerificationEvidencePacket {
  schemaVersion: "spctre.agt.evidence.v1";
  generatedAt: string;
  verifier: { command: "agt verify --evidence"; strictCommand: "agt verify --evidence --strict" };
  artifact: PolicyArtifactExport;
  bundle: AgtCompatiblePolicyBundle;
  evidence: RuntimeDecisionEvidenceRecord[];
  verificationResults?: AgtVerificationResult[];
  provenance: {
    tenantId: string;
    workspaceId: string | null;
    branchId: string;
    revisionId: string;
    artifactHash: string;
    approvalCount: number;
    evidenceCount: number;
    policyRefCount: number;
    escalationCount: number;
  };
  escalations: Array<{
    id: string;
    decisionId: string;
    revisionId?: string;
    artifactHash: string;
    resolutionOutcome: "PROCEED" | "ESCALATE" | "ABORT";
    resolutionNote?: string;
    resolvedAt: string;
  }>;
}

/**
 * The exact `agt-runtime-evidence/v1` wire shape accepted by AGT. This is a
 * shape adapter only: callers must source its toolkit and deployment fields
 * from a live AGT runtime, and the verification worker must materialize the
 * referenced artifact after independently checking `policyContentHash`.
 */
export interface AgtRuntimeEvidenceV1 {
  schema: "agt-runtime-evidence/v1";
  generated_at: string;
  toolkit_version: string;
  deployment: {
    policy_files_loaded: string[];
    registered_tools: string[];
    audit_sink: { enabled: boolean; target: string };
    identity: { enabled: boolean; agent_id: string };
    packages: Array<{ package: string; version: string }>;
  };
  spctre: { policy_content_hash: string };
}

import type { PolicyControlMapping } from "./policy";
