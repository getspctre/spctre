import {
  buildPolicyArtifactExport,
  buildPolicyBranchTimeline,
  buildComplianceEvidenceExport,
  buildEvidenceRetentionPlan,
  buildPolicyImportResult,
  buildPolicyReviewQueue,
  buildSimulationRun,
  composePolicyLayers,
  diffPolicyRules,
  evaluatePublishReadiness,
  ingestAgtRuntimeDecision,
  parseAgtPolicyDocument,
  searchRuntimeDecisionEvidence,
  toAgtCompatiblePolicyBundle
} from "@spctre/policy-schema";
import type {
  PolicyApproval,
  PolicyApprovalRule,
  PolicyBranch,
  PolicyBranchTimeline,
  PolicyComplianceEvidenceExport,
  EvidenceRetentionPlan,
  EvidenceRetentionRule,
  PolicyImportResult,
  PolicyRuleSummary,
  PolicyReviewTask,
  RuntimeEvidenceSearchResult,
  RuntimeTarget,
  RuntimeDecisionEvidenceRecord,
  SimulationReplayInput
} from "@spctre/policy-schema";
import type { RuleHeatEntry, UnusedRule } from "@/lib/repositories/policy";

export const branches: PolicyBranch[] = [
  {
    id: "br-prod-support",
    name: "prod/support",
    scope: "WORKSPACE",
    activeRevision: "rev-8f12",
    author: "platform",
    status: "PUBLISHED",
    message: "Published governance bundle for AWS Bedrock support agents"
  },
  {
    id: "br-refund-review",
    name: "refund-review",
    scope: "CONNECTOR",
    activeRevision: "rev-a441",
    parentRevision: "rev-8f12",
    author: "pm-ops",
    status: "IN_REVIEW",
    message: "Tighten Stripe refund rules before next billing cycle"
  },
  {
    id: "br-incident-mode",
    name: "incident-mode",
    scope: "ENVIRONMENT",
    activeRevision: "rev-c270",
    parentRevision: "rev-8f12",
    author: "security",
    status: "DRAFT",
    message: "Temporary production deploy restrictions"
  }
];

export const rules: PolicyRuleSummary[] = [
  {
    stableRuleId: "stripe.refund.manager_approval",
    title: "Refunds above limit require approval",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    sourcePath: "policies/stripe/refunds.yaml",
    domains: ["billing"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: true
  },
  {
    stableRuleId: "github.deploy.freeze",
    title: "Production deploys blocked during incident mode",
    effect: "WARN",
    sourceFormat: "OPA_REGO",
    sourcePath: "policies/github/deploy.rego",
    domains: ["release"],
    connectors: ["github"],
    actions: ["deployment.create"],
    immutable: false
  }
];

const refundPolicySource = `
name: stripe-refund-review
owner: billing-ops
rules:
  - stable_rule_id: stripe.refund.manager_approval
    title: Refunds above $500 require manager approval
    effect: DENY
    domains: [billing]
    connectors: [stripe]
    actions: [refund.create, refund.update]
    immutable: true
  - stable_rule_id: stripe.refund.customer_history
    title: Flag refunds after recent chargebacks
    effect: WARN
    domains: [billing, risk]
    connectors: [stripe]
    actions: [refund.create]
    immutable: false
  - stable_rule_id: stripe.refund.audit_note
    title: Refund decisions must include an audit note
    effect: DENY
    domains: [billing, audit]
    connectors: [stripe]
    actions: [refund.create]
    immutable: true
`;

const parsedRefundPolicy = parseAgtPolicyDocument({
  document: refundPolicySource,
  sourcePath: "policies/stripe/refunds.yaml"
});

const importResult = buildPolicyImportResult({
  id: "imp-stripe-refunds-014",
  branchId: "br-refund-review",
  revisionId: "rev-a441",
  sourceFormat: "AGT_YAML",
  sourcePath: "policies/stripe/refunds.yaml",
  sourceHash: "sha256:0f19c81b22...",
  author: "pm-ops",
  importedAt: "2026-04-29T15:11:00.000Z",
  rules: parsedRefundPolicy.rules,
  inheritedRevisionIds: ["rev-org-211"],
  warnings: parsedRefundPolicy.warnings,
  diagnostics: parsedRefundPolicy.diagnostics,
  metadata: parsedRefundPolicy.metadata
}) as Required<PolicyImportResult>;

const organizationBaselineRules: PolicyRuleSummary[] = [
  {
    stableRuleId: "org.sensitive_data.no_export",
    title: "Sensitive data cannot leave approved workspaces",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    sourcePath: "policies/org/baseline.yaml",
    domains: ["security"],
    connectors: ["stripe", "zendesk", "salesforce"],
    actions: ["*.export"],
    immutable: true
  }
];

const workspaceSupportRules: PolicyRuleSummary[] = [
  {
    stableRuleId: "support.customer_refund.scope",
    title: "Support agents can only refund assigned customer accounts",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    sourcePath: "policies/support/workspace.yaml",
    domains: ["billing", "support"],
    connectors: ["stripe"],
    actions: ["refund.create", "refund.update"],
    immutable: true
  }
];

export const compositionPreview = composePolicyLayers({
  id: "compose-support-refunds-022",
  branchId: "br-refund-review",
  revisionId: "rev-a441",
  layers: [
    {
      scope: "ORGANIZATION",
      branchId: "org-baseline",
      revisionId: "rev-org-211",
      ruleCount: 6,
      artifactHash: "sha256:88cd...",
      rules: organizationBaselineRules
    },
    {
      scope: "WORKSPACE",
      branchId: "br-prod-support",
      revisionId: "rev-8f12",
      ruleCount: 4,
      artifactHash: "sha256:4a1f...",
      rules: workspaceSupportRules
    },
    {
      scope: "CONNECTOR",
      branchId: "br-refund-review",
      revisionId: "rev-a441",
      ruleCount: importResult.rules.length,
      artifactHash: "sha256:7c2f...",
      rules: importResult.rules
    }
  ],
  composedArtifactHash: "sha256:7c2f0c9a1e...",
  composedAt: "2026-04-29T15:20:00.000Z"
});

const previousRefundRules: PolicyRuleSummary[] = [
  {
    stableRuleId: "stripe.refund.manager_approval",
    title: "Refunds above limit require manager approval",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    sourcePath: "policies/stripe/refunds.yaml",
    domains: ["billing"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: false
  },
  {
    stableRuleId: "stripe.refund.audit_note",
    title: "Refund decisions must include an audit note",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    sourcePath: "policies/stripe/refunds.yaml",
    domains: ["billing", "audit"],
    connectors: ["stripe"],
    actions: ["refund.create"],
    immutable: true
  }
];

export const revisionDiff = diffPolicyRules({
  branchId: "br-refund-review",
  baseRevisionId: "rev-8f12",
  compareRevisionId: "rev-a441",
  before: previousRefundRules,
  after: importResult.rules
});

const approvalRules: PolicyApprovalRule[] = [
  {
    role: "Security",
    requiredCount: 1
  },
  {
    role: "Product Ops",
    requiredCount: 1
  },
  {
    role: "Billing Owner",
    requiredCount: 1
  }
];

const approvals: PolicyApproval[] = [
  {
    reviewer: "maya@spctre.local",
    role: "Security",
    status: "APPROVED",
    reviewedAt: "2026-04-29T14:18:00.000Z"
  },
  {
    reviewer: "lee@spctre.local",
    role: "Product Ops",
    status: "PENDING"
  },
  {
    reviewer: "nora@spctre.local",
    role: "Billing Owner",
    status: "CHANGES_REQUESTED",
    reviewedAt: "2026-04-29T15:02:00.000Z"
  }
];

const publishReadiness = evaluatePublishReadiness({
  branchId: "br-refund-review",
  revisionId: "rev-a441",
  approvalRules,
  approvals
});

const targetStacks: RuntimeTarget[] = [
  {
    stack: "AWS_BEDROCK",
    adapter: "agt-compatible-bedrock",
    environment: "production"
  },
  {
    stack: "OPENAI_AGENTS",
    adapter: "agt-compatible-openai-agents",
    environment: "production"
  },
  {
    stack: "LOCAL",
    adapter: "agt-compatible-local",
    environment: "staging"
  }
];

export const agtBundlePreview = toAgtCompatiblePolicyBundle({
  tenantId: "tenant-demo",
  workspaceId: "support",
  branchId: "br-refund-review",
  revisionId: "rev-a441",
  sourceFormat: importResult.sourceFormat,
  sourcePath: importResult.sourcePath,
  sourceHash: importResult.sourceHash,
  artifactHash: compositionPreview.composedArtifactHash,
  targetStacks,
  approvals: publishReadiness.approvals,
  rules: compositionPreview.effectiveRules,
  metadata: {
    composition_id: compositionPreview.id,
    import_id: importResult.id
  },
  generatedAt: "2026-04-29T15:22:00.000Z"
});

export const artifactExport = buildPolicyArtifactExport({
  bundle: agtBundlePreview,
  generatedAt: "2026-04-29T15:23:00.000Z"
});

const simulationResults: SimulationReplayInput[] = [
  {
    eventId: "evt-refund-8821",
    connector: "stripe",
    action: "refund.update",
    previousStatus: "ALLOW",
    proposedStatus: "DENY",
    delta: "NEW_DENY",
    matchedPolicyRefs: ["stripe.refund.manager_approval"],
    reason: "Refund updates over $500 now require manager approval."
  },
  {
    eventId: "evt-refund-8799",
    connector: "stripe",
    action: "refund.create",
    previousStatus: "ALLOW",
    proposedStatus: "WARN",
    delta: "MODIFIED",
    matchedPolicyRefs: ["stripe.refund.customer_history"],
    reason: "Customer history rule warns on recent chargeback activity."
  },
  {
    eventId: "evt-refund-8714",
    connector: "stripe",
    action: "refund.create",
    previousStatus: "DENY",
    proposedStatus: "DENY",
    delta: "UNCHANGED",
    matchedPolicyRefs: ["stripe.refund.audit_note"],
    reason: "Audit note requirement still blocks incomplete refund decisions."
  }
];

export const simulationRun = buildSimulationRun({
  id: "sim-refund-review-041",
  branchId: "br-refund-review",
  revisionId: "rev-a441",
  sourceEventCount: 128,
  createdBy: "pm-ops",
  createdAt: "2026-04-29T15:28:00.000Z",
  results: simulationResults
});

export const audits: RuntimeDecisionEvidenceRecord[] = [
  ingestAgtRuntimeDecision({
    decisionId: "runtime-decision-1042",
    tenantId: "tenant-demo",
    workspaceId: "support",
    environment: "production",
    runtimeTarget: {
      stack: "AWS_BEDROCK",
      adapter: "agt-compatible-bedrock"
    },
    agentId: "support-agent-7",
    connector: "stripe",
    action: "refund.create",
    status: "DENY",
    reason: "Stripe refunds over the configured limit require manager approval.",
    toolIntent: "Refund an overcharged customer",
    planSummary: "1. Retrieve charge details.\n2. Verify overcharge amount.\n3. Issue refund.",
    toolParameters: { amount: 600, reason: "requested_by_customer" },
    policyRefs: ["stripe.refund.manager_approval"],
    artifactHash: "sha256:4a1f...",
    policyContext: [
      {
        scope: "ORGANIZATION",
        branchId: "org-baseline",
        revisionId: "rev-org-211",
        artifactHash: "sha256:88cd..."
      },
      {
        scope: "WORKSPACE",
        branchId: "br-prod-support",
        revisionId: "rev-8f12",
        artifactHash: "sha256:4a1f..."
      }
    ],
    latencyMs: 1,
    createdAt: "2026-04-28T22:44:00.000Z",
    rawEvidence: {
      source: "agt-compatible-bedrock",
      request_id: "bedrock-req-1042"
    }
  }),
  ingestAgtRuntimeDecision({
    decisionId: "runtime-decision-1041",
    tenantId: "tenant-demo",
    workspaceId: "platform",
    environment: "production",
    runtimeTarget: {
      stack: "LANGCHAIN",
      adapter: "agt-compatible-langchain"
    },
    agentId: "release-agent-2",
    connector: "github",
    action: "deployment.create",
    status: "WARN",
    reason: "Production deploy is covered by the active incident-mode policy.",
    toolIntent: "Deploy emergency hotfix to production",
    planSummary: "1. Build image.\n2. Push to ECR.\n3. Trigger rollout.",
    toolParameters: { environment: "production", tag: "hotfix-123" },
    policyRefs: ["github.deploy.freeze"],
    artifactHash: "sha256:91bc...",
    policyContext: [
      {
        scope: "ORGANIZATION",
        branchId: "org-baseline",
        revisionId: "rev-org-211",
        artifactHash: "sha256:88cd..."
      },
      {
        scope: "ENVIRONMENT",
        branchId: "br-incident-mode",
        revisionId: "rev-c270",
        artifactHash: "sha256:91bc..."
      }
    ],
    latencyMs: 1,
    createdAt: "2026-04-28T22:40:00.000Z",
    rawEvidence: {
      source: "agt-compatible-langchain",
      request_id: "lc-run-1041"
    }
  }),
  ingestAgtRuntimeDecision({
    decisionId: "runtime-decision-1040",
    tenantId: "tenant-demo",
    workspaceId: "support",
    environment: "staging",
    runtimeTarget: {
      stack: "LOCAL",
      adapter: "agt-compatible-local"
    },
    agentId: "support-agent-sim",
    connector: "stripe",
    action: "refund.update",
    status: "DENY",
    reason: "Staging replay used the proposed refund-review artifact for refund updates.",
    toolIntent: "Modify refund reason for accounting",
    planSummary: "Update refund description to match support ticket.",
    toolParameters: { refund_id: "re_123", metadata: { ticket: "TSK-992" } },
    policyRefs: ["stripe.refund.manager_approval", "support.customer_refund.scope"],
    artifactHash: compositionPreview.composedArtifactHash,
    policyContext: [
      {
        scope: "WORKSPACE",
        branchId: "br-prod-support",
        revisionId: "rev-8f12",
        artifactHash: "sha256:4a1f..."
      },
      {
        scope: "CONNECTOR",
        branchId: "br-refund-review",
        revisionId: "rev-a441",
        artifactHash: compositionPreview.composedArtifactHash
      }
    ],
    latencyMs: 1,
    createdAt: "2026-04-29T15:31:00.000Z",
    rawEvidence: {
      source: "agt-compatible-local",
      request_id: "local-replay-1040"
    }
  })
];

const retentionRules: EvidenceRetentionRule[] = [
  {
    id: "ret-deny-production",
    label: "Production deny evidence",
    retentionDays: 1095,
    appliesTo: {
      statuses: ["DENY"],
      environments: ["production"]
    },
    exportable: true
  },
  {
    id: "ret-warning-production",
    label: "Production warnings",
    retentionDays: 365,
    appliesTo: {
      statuses: ["WARN"],
      environments: ["production"]
    },
    exportable: true
  },
  {
    id: "ret-local-staging",
    label: "Staging replay evidence",
    retentionDays: 2,
    appliesTo: {
      environments: ["staging"],
      runtimeStacks: ["LOCAL"]
    },
    exportable: false
  }
];

export const retentionPlan: EvidenceRetentionPlan = buildEvidenceRetentionPlan({
  id: "ret-support-2026-04",
  evidence: audits,
  rules: retentionRules,
  generatedAt: "2026-04-30T00:00:00.000Z",
  expiringWithinDays: 7
});

export const branchTimeline: PolicyBranchTimeline = buildPolicyBranchTimeline({
  branchId: "br-refund-review",
  revisionId: "rev-a441",
  events: [
    {
      id: importResult.id,
      kind: "IMPORT",
      branchId: importResult.branchId,
      revisionId: importResult.revisionId,
      title: "Imported AGT source policy",
      detail: `${importResult.rules.length} parsed rules from ${importResult.sourcePath}.`,
      actor: importResult.author,
      status: importResult.warnings.length ? "WARNINGS" : "CLEAN",
      sourceId: importResult.id,
      createdAt: importResult.importedAt
    },
    {
      id: compositionPreview.id,
      kind: "COMPOSE",
      branchId: compositionPreview.branchId,
      revisionId: compositionPreview.revisionId,
      title: "Composed effective rule set",
      detail: `${compositionPreview.layers.length} policy layers produced ${compositionPreview.effectiveRules.length} effective rules.`,
      status: compositionPreview.conflictNotes.length ? "CONFLICTS" : "CLEAN",
      artifactHash: compositionPreview.composedArtifactHash,
      sourceId: compositionPreview.id,
      createdAt: compositionPreview.composedAt
    },
    {
      id: `${revisionDiff.baseRevisionId}-${revisionDiff.compareRevisionId}`,
      kind: "DIFF",
      branchId: revisionDiff.branchId,
      revisionId: revisionDiff.compareRevisionId,
      title: "Computed stable rule diff",
      detail: `${revisionDiff.summary.added} added, ${revisionDiff.summary.modified} modified, ${revisionDiff.summary.removed} removed.`,
      status: "READY",
      sourceId: `${revisionDiff.baseRevisionId}-${revisionDiff.compareRevisionId}`,
      createdAt: "2026-04-29T15:21:00.000Z"
    },
    ...publishReadiness.approvals.map((approval) => ({
      id: `${approval.role}-${approval.reviewer}`,
      kind: "APPROVAL" as const,
      branchId: publishReadiness.branchId,
      revisionId: publishReadiness.revisionId,
      title: `${approval.role} review`,
      detail: `${approval.reviewer} is ${approval.status.toLowerCase().replace("_", " ")}.`,
      actor: approval.reviewer,
      status: approval.status,
      sourceId: `${approval.role}-${approval.reviewer}`,
      createdAt: approval.reviewedAt ?? "2026-04-29T15:24:00.000Z"
    })),
    {
      id: artifactExport.artifactHash,
      kind: "EXPORT",
      branchId: artifactExport.branchId,
      revisionId: artifactExport.revisionId,
      title: "Generated AGT-compatible artifact",
      detail: `${artifactExport.rules.length} rules targeted at ${artifactExport.targetStacks.length} runtimes.`,
      status: "GENERATED",
      artifactHash: artifactExport.artifactHash,
      sourceId: artifactExport.artifactHash,
      createdAt: artifactExport.generatedAt
    },
    {
      id: simulationRun.id,
      kind: "SIMULATION",
      branchId: simulationRun.branchId,
      revisionId: simulationRun.revisionId,
      title: "Replayed historical actions",
      detail: `${simulationRun.newlyDeniedCount} newly denied and ${simulationRun.newlyAllowedCount} newly allowed from ${simulationRun.sourceEventCount} events.`,
      actor: simulationRun.createdBy,
      status: "SAMPLED",
      sourceId: simulationRun.id,
      createdAt: simulationRun.createdAt
    },
    ...audits
      .filter((audit) =>
        audit.policyContext.some(
          (context) =>
            context.branchId === "br-refund-review" && context.revisionId === "rev-a441"
        )
      )
      .map((audit) => ({
        id: audit.decisionId,
        kind: "EVIDENCE" as const,
        branchId: "br-refund-review",
        revisionId: "rev-a441",
        title: `Observed ${audit.connector}.${audit.action}`,
        detail: audit.reason,
        actor: audit.agentId,
        status: audit.status,
        artifactHash: audit.artifactHash,
        sourceId: audit.decisionId,
        createdAt: audit.createdAt
      }))
  ]
});

export const complianceExport: PolicyComplianceEvidenceExport = buildComplianceEvidenceExport({
  id: "cmp-refund-review-007",
  artifact: artifactExport,
  readiness: publishReadiness,
  timeline: branchTimeline,
  evidence: audits,
  simulationRun,
  generatedAt: "2026-04-29T15:35:00.000Z",
  retentionDays: 90
});

export const mockHeatmap: RuleHeatEntry[] = [
  { ruleId: "stripe.refund.manager_approval", denyCount: 23, warnCount: 8, allowCount: 0, total: 31 },
  { ruleId: "github.deploy.freeze", denyCount: 12, warnCount: 4, allowCount: 0, total: 16 },
  { ruleId: "stripe.refund.customer_history", denyCount: 7, warnCount: 14, allowCount: 3, total: 24 },
  { ruleId: "stripe.subscription.downgrade_block", denyCount: 5, warnCount: 2, allowCount: 1, total: 8 },
  { ruleId: "salesforce.contract.approval_required", denyCount: 3, warnCount: 6, allowCount: 0, total: 9 },
];

export const mockUnusedRules: UnusedRule[] = [
  {
    stableRuleId: "salesforce.opportunity.bulk_close",
    title: "Bulk opportunity close requires VP approval",
    effect: "DENY",
    connectors: ["salesforce"],
    domains: ["crm"],
  },
  {
    stableRuleId: "github.secrets.export_block",
    title: "Block secrets export from repositories",
    effect: "DENY",
    connectors: ["github"],
    domains: ["security"],
  },
];
