import type {
  RuntimeStack,
  RuntimeDecisionStatus,
  RuntimeTarget,
  RuntimeEvidenceSearchQuery,
  PolicyRuleDiagnostic,
  TriggerKind,
  EvidenceLayer,
} from "./decisions";

export interface ExecutionContext {
  backend?: string;
  sessionId?: string;
  sandboxName?: string;
  inferenceProvider?: string;
  sandboxPolicyRef?: string;
  inferenceRouterRef?: string;
}

export interface OrchestratorRef {
  platform: string;
  companyId?: string;
  issueId?: string;
  goalId?: string;
}

export interface SkillContext {
  activeSkills: string[];
  instructionFiles?: string[];
  promptPolicyRefs?: string[];
  promptSurface?: string;
}

export type PluginSource =
  "public_marketplace" | "corporate_marketplace" | "corporate_private" | "user_built";

export type PolicySourceDialect = "AGT_YAML" | "OPA_REGO" | "CEDAR" | "SPCTRE_MANAGED";

/** The outcome of translating a native policy source into Spctre rules. */
export type PolicySourceTranslationStatus = "EXACT" | "LOSSY" | "UNSUPPORTED";

export interface PolicySourceTranslationMapping {
  sourceId: string;
  stableRuleId?: string;
  outcome: PolicySourceTranslationStatus;
  message?: string;
}

export interface PolicySourceTranslationReport {
  sourceFormat: Extract<PolicySourceDialect, "OPA_REGO" | "CEDAR">;
  translatorVersion: string;
  status: PolicySourceTranslationStatus;
  mappings: PolicySourceTranslationMapping[];
  diagnostics: PolicyRuleDiagnostic[];
}

export interface SemanticCheck {
  id: string;
  prompt: string;
  effect?: RuntimeDecisionStatus;
}

/** A standards control supported by a versioned policy rule. */
export interface PolicyControlMapping {
  framework:
    "SOC2" | "HIPAA" | "ISO_27001" | "ISO_42001" | "EU_AI_ACT" | "NIST_AI_RMF" | "OWASP_AGENTIC";
  controlId: string;
  rationale?: string;
}

export type PolicyDynamicConditionKind =
  | "TIME_WINDOW"
  | "DAILY_SPEND_LIMIT"
  | "PER_CALL_COST_LIMIT"
  | "SESSION_CUMULATIVE_COST_LIMIT"
  | "BUDGET_UTILIZATION_THRESHOLD";

export interface PolicyDynamicCondition {
  kind: PolicyDynamicConditionKind;
  source: "AGT_CONDITION" | "AGT_NATIVE_FIELD";
  field?: string;
  operator?: string;
  value?: unknown;
  window?: Record<string, unknown>;
  originalCondition: Record<string, unknown>;
}

export type PolicyParameterConstraintOperator =
  "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "in" | "not_in" | "contains";

/**
 * A deterministic tool-parameter check evaluated at decision time. Distinct
 * from PolicyDynamicCondition, which is import/export-time metadata only and
 * is never read by evaluateDecision.
 */
export interface PolicyParameterConstraint {
  /** Dot-path into toolParameters, e.g. "amount_cents" or "branch.protected". */
  field: string;
  operator: PolicyParameterConstraintOperator;
  /** Literal default baked into the pack at authoring time. */
  value: unknown;
  /** Workspace-overridable knob name; see PolicyPackParameterDefinition. */
  parameterKey?: string;
  /** Overrides rule.effect when this constraint matches. */
  effect?: RuntimeDecisionStatus;
}

/** A pack-level catalog entry describing an overridable parameter knob. */
export interface PolicyPackParameterDefinition {
  key: string;
  label: string;
  type: "number" | "string" | "boolean" | "enum";
  default: unknown;
  enumValues?: string[];
  description?: string;
}

export interface PolicyRuleSummary {
  stableRuleId: string;
  title: string;
  effect: RuntimeDecisionStatus;
  sourceFormat: string;
  sourcePath?: string;
  domains: string[];
  connectors: string[];
  actions: string[];
  immutable: boolean;
  priority?: number;
  conditions?: Record<string, unknown>[];
  dynamicConditions?: PolicyDynamicCondition[];
  semanticChecks?: SemanticCheck[];
  parameterConstraints?: PolicyParameterConstraint[];
  controlMappings?: PolicyControlMapping[];
  originalRule?: Record<string, unknown>;
  preservedFields?: Record<string, unknown>;
  runtimeStacks?: RuntimeStack[];
  sandboxNames?: string[];
  inferenceProviders?: string[];
  orchestratorPlatforms?: string[];
  companyIds?: string[];
  issueIds?: string[];
  goalIds?: string[];
  triggerKind?: TriggerKind;
  layer?: EvidenceLayer;
  trustLevels?: string[];
  pluginSources?: PluginSource[];
  skillIds?: string[];
  promptSurfaces?: string[];
  catalogProviders?: string[];
}

export interface PolicyArtifactExport {
  branchId: string;
  revisionId: string;
  artifactHash: string;
  sourceHash: string;
  sourceFormat: string;
  targetStacks: RuntimeTarget[];
  rules: PolicyRuleSummary[];
  generatedAt: string;
}

export type PolicyBundleExportFormat =
  "spctre-json" | "opa-rego" | "opa-bundle" | "cedar" | "mcp-proxy-config";

export type PolicyBundleExportCompatibilityLevel =
  "NATIVE" | "LOSSLESS_PRESERVED" | "PARTIAL_SEMANTIC_MAP";

export interface PolicyBundleExportManifest {
  format: PolicyBundleExportFormat;
  target: string;
  compatibilityLevel: PolicyBundleExportCompatibilityLevel;
  semanticWarnings: string[];
  blockingWarnings: string[];
  verificationTargets: string[];
  artifactHash: string;
  compiledArtifactHash: string;
  generatedAt: string;
  provenance: {
    tenantId: string;
    workspaceId: string | null;
    branchId: string;
    revisionId: string;
    sourceHash: string;
    sourceFormat: string;
    sourcePath?: string;
    targetStacks: RuntimeTarget[];
  };
  ruleCount: number;
}

export interface PolicyBundleExportResult<TArtifact = string | Record<string, unknown>> {
  ok: boolean;
  format: PolicyBundleExportFormat;
  contentType: string;
  fileName: string;
  artifact: TArtifact | null;
  manifest: PolicyBundleExportManifest;
}

export interface PolicyBundleExportVerification {
  ok: boolean;
  expectedHash: string;
  actualHash: string | null;
  issues: string[];
}

export interface PolicyApproval {
  reviewer: string;
  role: string;
  status: "APPROVED" | "CHANGES_REQUESTED" | "PENDING";
  reviewedAt?: string;
}

export interface PolicyApprovalRule {
  role: string;
  requiredCount: number;
}

export interface ApprovalWorkflowRuleSnapshot {
  role: string;
  requiredCount: number;
  eligibleRoles: string[];
  sequence: number;
  namedReviewers?: string[];
}

export interface ApprovalVerificationPolicy {
  requireVerification?: boolean;
  blockOnFail?: boolean;
  blockOnStale?: boolean;
}

export interface ApprovalWorkflowSnapshot {
  id: string;
  name: string;
  reviewMode: "PARALLEL" | "SEQUENTIAL";
  workspaceId?: string;
  environment?: string;
  rules: ApprovalWorkflowRuleSnapshot[];
  verificationPolicy?: ApprovalVerificationPolicy;
  generatedAt: string;
}

export interface PolicyBranch {
  id: string;
  name: string;
  scope: "ORGANIZATION" | "WORKSPACE" | "ENVIRONMENT" | "CONNECTOR" | "COMPANY";
  environment?: string;
  connector?: string;
  activeRevision: string;
  parentRevision?: string;
  author: string;
  status: "PUBLISHED" | "IN_REVIEW" | "DRAFT";
  message: string;
}

/**
 * The declared operating envelope for one logical agent. Blueprints govern
 * intent and permitted operating surfaces; they do not schedule, prompt, or
 * otherwise orchestrate an agent.
 */
export interface AgentBlueprintDefinition {
  purpose: string;
  allowedTaskClasses: string[];
  tools: string[];
  connectors: string[];
  services: string[];
  environments: string[];
  runtimeTargets: RuntimeTarget[];
  budgets?: {
    maxTokensPerTurn?: number;
    maxCostUsdPerSession?: number;
    maxToolCallsPerSession?: number;
  };
  approvalPath?: string[];
  policyBranchId?: string;
  policyRevisionId?: string;
}

export type AgentBlueprintStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED";

export interface AgentBlueprintSummary {
  id: string;
  name: string;
  agentId: string;
  workspaceId: string;
  activeRevisionId: string;
  status: AgentBlueprintStatus;
  policyBranchId?: string;
  policyRevisionId?: string;
  updatedAt: string;
}

export interface AgentBlueprintRevision {
  id: string;
  blueprintId: string;
  parentRevisionId?: string;
  definition: AgentBlueprintDefinition;
  definitionHash: string;
  message: string;
  authorId: string;
  status: AgentBlueprintStatus;
  createdAt: string;
  publishedAt?: string;
}

/** Immutable Blueprint revision that governed a runtime decision. */
export interface RuntimeBlueprintContext {
  blueprintId: string;
  revisionId: string;
  definitionHash: string;
  name: string;
}

/** Portable, runtime-consumable output compiled from a published Blueprint. */
export interface AgentBlueprintRuntimeArtifact {
  kind: "spctre.agent-blueprint.v1";
  blueprint: RuntimeBlueprintContext;
  purpose: string;
  allowedTaskClasses: string[];
  tools: string[];
  connectors: string[];
  services: string[];
  environments: string[];
  runtimeTargets: RuntimeTarget[];
  budgets?: AgentBlueprintDefinition["budgets"];
  approvalPath?: string[];
  policy?: { branchId?: string; revisionId?: string; artifactHash?: string };
  generatedAt: string;
}

export interface AgentBlueprintRevisionDiff {
  blueprintId: string;
  baseRevisionId: string;
  compareRevisionId: string;
  changedFields: Array<keyof AgentBlueprintDefinition>;
  summary: string;
}

export interface RuntimePolicyContext {
  scope: PolicyBranch["scope"];
  branchId: string;
  revisionId: string;
  artifactHash: string;
  packId?: string;
  packVersion?: string;
  packOwner?: string;
}

export interface RuntimeDecisionEvidenceRecord {
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
  policyRefs: string[];
  artifactHash: string;
  policyContext: RuntimePolicyContext[];
  latencyMs: number;
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  createdAt: string;
  rawEvidence: Record<string, unknown>;
  executionContext?: ExecutionContext;
  parentAgentId?: string;
  traceId?: string;
  orchestratorRef?: OrchestratorRef;
  triggerKind?: TriggerKind;
  skillContext?: SkillContext;
  pluginSource?: PluginSource;
  layer?: EvidenceLayer;
  webhookSource?: string;
  trustLevel?: string;
  catalogProvider?: string;
  blueprintContext?: RuntimeBlueprintContext;
}

export interface AgtRuntimeDecisionInput extends Omit<
  RuntimeDecisionEvidenceRecord,
  "runtimeTarget"
> {
  runtimeTarget: RuntimeTarget;
}

export interface RuntimeEvidenceSearchResult {
  query: RuntimeEvidenceSearchQuery;
  results: RuntimeDecisionEvidenceRecord[];
  totalCount: number;
  returnedCount: number;
  deniedCount: number;
  warnedCount: number;
  allowedCount: number;
  policyRefCount: number;
}

export interface CompositionLayer {
  scope: PolicyBranch["scope"];
  branchId: string;
  revisionId: string;
  ruleCount: number;
  artifactHash: string;
  rules: PolicyRuleSummary[];
}

export interface PolicyCompositionPreview {
  id: string;
  branchId: string;
  revisionId: string;
  layers: CompositionLayer[];
  composedArtifactHash: string;
  composedAt: string;
  effectiveRules: PolicyRuleSummary[];
  conflictNotes: string[];
}

export interface PolicyReviewTask {
  role: string;
  status: PolicyApproval["status"];
  requiredCount: number;
  satisfiedCount: number;
}

export interface PolicyRuleDiff {
  stableRuleId: string;
  status: "ADDED" | "REMOVED" | "MODIFIED" | "UNCHANGED";
  before?: PolicyRuleSummary;
  after?: PolicyRuleSummary;
  changedFields?: string[];
}

export interface PolicyRevisionDiff {
  branchId: string;
  baseRevisionId: string;
  compareRevisionId: string;
  before: PolicyRuleSummary[];
  after: PolicyRuleSummary[];
  rules: PolicyRuleDiff[];
  summary: { added: number; modified: number; removed: number; unchanged: number };
}

export interface AgtCompatibilityReport {
  dialect: PolicySourceDialect;
  compatibilityLevel: "NATIVE" | "LOSSLESS_PRESERVED" | "PARTIAL_SEMANTIC_MAP";
  agtVersion?: string;
  agtPoliciesVersion?: string;
  cedarPolicyVersion?: string;
  policyEngineVersion?: string;
  compatibilityCheckedAt?: string;
  compatibilityCheckOutcome?: "PASS" | "FAIL" | "WARN";
  preservedTopLevelKeys: string[];
  preservedRuleFieldCount: number;
  dynamicConditionCount?: number;
  semanticWarnings: string[];
  verificationTargets: string[];
}

export interface AgtCompatiblePolicyBundle {
  tenantId: string;
  workspaceId: string | null;
  branchId: string;
  revisionId: string;
  sourceFormat: string;
  sourcePath?: string;
  sourceHash: string;
  artifactHash: string;
  targetStacks: RuntimeTarget[];
  approvals: PolicyApproval[];
  rules: PolicyRuleSummary[];
  generatedAt: string;
  metadata: Record<string, unknown>;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
}

export interface SimulationReplayInput {
  eventId: string;
  connector: string;
  action: string;
  previousStatus: RuntimeDecisionStatus;
  proposedStatus: RuntimeDecisionStatus;
  delta: "UNCHANGED" | "NEW_DENY" | "NEW_ALLOW" | "MODIFIED";
  matchedPolicyRefs: string[];
  reason: string;
}

/**
 * The decision-relevant findings from replaying a proposed revision against
 * retained runtime evidence.  This deliberately records classes of regression
 * rather than treating every changed outcome as a failure.
 */
export interface SimulationRegressionSummary {
  coverage: "SAMPLED" | "RETAINED_LOG";
  newlyDeniedExpectedWorkCount: number;
  removedEscalationCoverageCount: number;
  newlyAllowedHighRiskCount: number;
  blockingCount: number;
}

export interface SimulationRun {
  id: string;
  branchId: string;
  revisionId: string;
  sourceEventCount: number;
  createdBy: string;
  createdAt: string;
  results: SimulationReplayInput[];
  newlyDeniedCount: number;
  newlyAllowedCount: number;
  unchangedCount: number;
  regressionSummary?: SimulationRegressionSummary;
}

export interface PolicyImportResult {
  id?: string;
  branchId?: string;
  revisionId?: string;
  sourceFormat?: string;
  sourcePath?: string;
  sourceHash: string;
  author?: string;
  importedAt?: string;
  rules: PolicyRuleSummary[];
  inheritedRevisionIds?: string[];
  diagnostics: PolicyRuleDiagnostic[];
  warnings: string[];
  metadata: Record<string, unknown>;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
  translation?: PolicySourceTranslationReport;
}

export interface PolicyPack {
  id: string;
  name: string;
  connector: string;
  description: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  domains: string[];
  rules: Array<Omit<PolicyRuleSummary, "sourceFormat" | "sourcePath">>;
  metadata: Record<string, unknown>;
  /** Overridable knobs referenced by rule-level parameterConstraints.parameterKey. */
  parameters?: PolicyPackParameterDefinition[];
}

export interface PolicyPackChangelogEntry {
  version: string;
  date: string;
  summary: string;
}

export interface PolicyPackMetadata {
  name: string;
  version: string;
  connector: string;
  author: string;
  owner: string;
  riskLevel: PolicyPack["riskLevel"];
  riskTags: string[];
  generated: boolean;
  category: string;
  compatibilityTargets: string[];
  reviewRoles: string[];
  minimumApprovals: number;
  changelog: PolicyPackChangelogEntry[];
}
