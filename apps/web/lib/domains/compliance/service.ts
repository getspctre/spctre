import {
  RETENTION_RULES,
  DEFAULT_EXPIRING_WITHIN_DAYS,
  DEFAULT_COMPLIANCE_RETENTION_DAYS,
} from "@/lib/retention-config";
import {
  buildComplianceEvidenceExport,
  buildControlEvidenceRollup,
  buildEvidenceRetentionPlan,
  buildPolicyBranchTimeline,
  evaluatePublishReadiness,
} from "@spctre/policy-schema";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { archivalService } from "@/lib/ee-adapters/archival";
import { getWorkspaceContext } from "@/lib/workspace";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { type AppViewMode } from "@/lib/app-view-mode";
import { runWithTenantContext } from "@/lib/tenant-context";
import { createTtlCache } from "@/lib/platform/ttl-cache";
import { getActiveActor } from "@/lib/actors";
import type {
  ControlEvidenceRollupEntry,
  EvidenceRetentionPlan,
  PolicyArtifactExport,
  PolicyBranchTimeline,
  PolicyComplianceEvidenceExport,
  RuntimeDecisionEvidenceRecord,
  SignedActionReceipt,
} from "@spctre/policy-schema";
import {
  appendOperationsLog,
  getOperationsLogEventCounts,
} from "@/lib/repositories/operations-log";
import {
  approvalRulesFromWorkflow,
  getApprovalWorkflowForContext,
} from "@/lib/repositories/approval-workflow";
import {
  deleteExpiredEvidenceEvents,
  eraseEvidencePiiEvents,
  getLatestPublishAndRevision,
  type EvidenceErasureFilters,
} from "@/lib/repositories/evidence/compliance";
import { getApprovals } from "@/lib/repositories/policy";
import { getCommercialProfile } from "@/lib/repositories/workspace";
import { getLatestVerificationStatus } from "@/lib/repositories/verification";
import {
  listApprovalTimelineEvents,
  targetStacksFromJson,
} from "@/lib/repositories/shared/revisions";
import {
  listResolvedEscalationsForRevision,
  type ResolvedEscalation,
} from "@/lib/repositories/gateway";
import { listRulesForRevision } from "@/lib/repositories/shared/rules";
import { listRuntimeEvidence } from "@/lib/repositories/evidence/runtime";
import { recordConversionTelemetry } from "@/lib/repositories/onboarding/telemetry";
import { listActionReceipts } from "@/lib/repositories/action-receipts";
import { listGrcDeliveryAttempts } from "@/lib/repositories/grc-delivery-attempts";
import {
  listGrcDeliveryDestinations,
  type GrcDeliveryDestination,
} from "@/lib/repositories/grc-delivery-destinations";
import { swallow } from "@/lib/platform/swallow";

export interface CompliancePacket {
  export: PolicyComplianceEvidenceExport;
  timeline: PolicyBranchTimeline;
  escalations: ResolvedEscalation[];
  actionReceipts: SignedActionReceipt[];
  controlEvidenceRollup: ControlEvidenceRollupEntry[];
  forensicLedger?: { ok: boolean; verifiedCount: number; error?: string };
}

export async function getCompliancePacket(
  workspaceId: string | null,
  tenantId: string,
): Promise<CompliancePacket | null> {
  return runWithTenantContext(tenantId, () => getCompliancePacketInTenant(workspaceId, tenantId));
}

async function getCompliancePacketInTenant(
  workspaceId: string | null,
  tenantId: string,
): Promise<CompliancePacket | null> {
  const published = await getLatestPublishAndRevision(workspaceId, tenantId);
  if (!published) return null;

  const [
    rules,
    approvals,
    evidence,
    approvalEvents,
    resolvedEscalations,
    approvalWorkflow,
    actionReceipts,
  ] = await Promise.all([
    listRulesForRevision(published.revision_id, tenantId),
    getApprovals(published.revision_id, tenantId),
    listRuntimeEvidence(workspaceId, tenantId),
    listApprovalTimelineEvents(published.branch_id, published.revision_id, tenantId),
    listResolvedEscalationsForRevision(published.revision_id, tenantId),
    getApprovalWorkflowForContext({ tenantId, workspaceId, environment: "production" }),
    listActionReceipts({ tenantId, workspaceId, revisionId: published.revision_id }).catch(
      swallow("listActionReceipts", []),
    ),
  ]);
  const generatedAt = new Date().toISOString();
  const artifact: PolicyArtifactExport = {
    branchId: published.branch_id,
    revisionId: published.revision_id,
    artifactHash: published.artifact_hash,
    sourceHash: published.source_hash,
    sourceFormat: published.source_format as PolicyArtifactExport["sourceFormat"],
    targetStacks: targetStacksFromJson(published.target_stacks),
    rules,
    generatedAt,
  };
  // Scope evidence to the published branch/revision before it's treated as
  // proof of anything — otherwise a historical event sharing a stable rule ID
  // across revisions could be presented as runtime proof for a rule/control
  // that only exists in (or changed under) the newly published revision.
  const evidenceForPublishedRevision = evidence.filter((record) =>
    record.policyContext.some(
      (context) =>
        context.branchId === published.branch_id && context.revisionId === published.revision_id,
    ),
  );
  const relevantEvidenceCount = evidenceForPublishedRevision.length;
  const timeline = buildPolicyBranchTimeline({
    branchId: published.branch_id,
    revisionId: published.revision_id,
    events: [
      {
        id: `import-${published.revision_id}`,
        kind: "IMPORT",
        branchId: published.branch_id,
        revisionId: published.revision_id,
        title: "Imported policy revision",
        detail: published.message,
        actor: published.author_id,
        status: published.source_format,
        artifactHash: published.source_hash,
        sourceId: published.revision_id,
        createdAt: published.revision_created_at.toISOString(),
      },
      ...approvalEvents,
      {
        id: `publish-${published.publish_id}`,
        kind: "EXPORT",
        branchId: published.branch_id,
        revisionId: published.revision_id,
        title: "Published runtime artifact",
        detail: "Approval-gated artifact made available to runtime targets.",
        actor: published.published_by,
        status: "PUBLISHED",
        artifactHash: published.artifact_hash,
        sourceId: published.publish_id,
        createdAt: published.published_at.toISOString(),
      },
      {
        id: `evidence-${published.revision_id}`,
        kind: "EVIDENCE",
        branchId: published.branch_id,
        revisionId: published.revision_id,
        title: "Linked runtime evidence",
        detail: `${relevantEvidenceCount} runtime decisions reference this branch and revision.`,
        status: relevantEvidenceCount ? "LINKED" : "PENDING",
        artifactHash: published.artifact_hash,
        sourceId: published.revision_id,
        createdAt: generatedAt,
      },
      ...resolvedEscalations.map((esc) => ({
        id: `escalation-${esc.id}`,
        kind: "ESCALATION" as const,
        branchId: published.branch_id,
        revisionId: published.revision_id,
        title: `Escalation resolved: ${esc.resolutionOutcome}`,
        detail: esc.resolutionNote
          ? `Decision ${esc.decisionId.slice(0, 12)} — ${esc.resolutionNote}`
          : `Decision ${esc.decisionId.slice(0, 12)} resolved with outcome ${esc.resolutionOutcome}.`,
        status: esc.resolutionOutcome,
        artifactHash: esc.artifactHash,
        sourceId: esc.id,
        createdAt: esc.resolvedAt,
      })),
    ],
  });
  const readiness = evaluatePublishReadiness({
    branchId: published.branch_id,
    revisionId: published.revision_id,
    approvalRules: approvalRulesFromWorkflow(approvalWorkflow),
    approvals,
    approvalWorkflow,
  });

  let forensicLedgerResult: { ok: boolean; verifiedCount: number; error?: string } | undefined;
  const plan = getSpctrePlan();
  if (
    isFeatureEnabledForPlan("longTermForensicArchival", plan) &&
    archivalService.verifyLedgerChain
  ) {
    try {
      const verification = await archivalService.verifyLedgerChain(tenantId, workspaceId ?? "");
      forensicLedgerResult = {
        ok: verification.ok,
        verifiedCount: verification.verifiedCount,
        error: verification.error,
      };
    } catch (err) {
      forensicLedgerResult = { ok: false, verifiedCount: 0, error: (err as Error).message };
    }
  }

  return {
    timeline,
    escalations: resolvedEscalations,
    actionReceipts,
    controlEvidenceRollup: buildControlEvidenceRollup({
      rules,
      evidence: evidenceForPublishedRevision,
    }),
    forensicLedger: forensicLedgerResult,
    export: buildComplianceEvidenceExport({
      id: `cmp-${published.revision_id.slice(0, 8)}`,
      artifact,
      readiness,
      timeline,
      evidence,
      generatedAt,
      retentionDays: DEFAULT_COMPLIANCE_RETENTION_DAYS,
    }),
  };
}

// Cache the compliance event-type breakdown briefly per tenant+workspace: it
// GROUP-BYs the whole tenant operations log and is a display figure on the
// compliance page, so a little staleness is fine. See
// database-optimizations-audit finding 5.
const operationsEventCountsCache = createTtlCache<Record<string, number>>({ ttlMs: 30_000 });

export async function getComplianceOperationsEventCounts(params: {
  tenantId: string;
  workspaceId: string;
}) {
  return operationsEventCountsCache.get(`${params.tenantId}:${params.workspaceId}`, () =>
    runWithTenantContext(params.tenantId, () =>
      getOperationsLogEventCounts(params.tenantId, params.workspaceId),
    ),
  );
}

export async function getComplianceVerificationStatus(params: {
  workspaceId: string;
  tenantId: string;
  artifactHash: string;
}) {
  return runWithTenantContext(params.tenantId, () =>
    getLatestVerificationStatus(params.workspaceId, params.tenantId, {
      artifactHash: params.artifactHash,
    }),
  );
}

export async function recordComplianceExportConversion(tenantId: string): Promise<void> {
  await recordConversionTelemetry(tenantId, "FIRST_COMPLIANCE_EXPORT");
}

export async function recordComplianceOperation(params: Parameters<typeof appendOperationsLog>[0]) {
  return appendOperationsLog(params);
}

function resolveActiveRules(profile: Awaited<ReturnType<typeof getCommercialProfile>> | null) {
  const planCode = profile?.planCode ?? "HOSTED_TRIAL";
  let retentionDays = 90;
  let label = "Hosted Trial 90-day retention limit";
  if (planCode === "TEAM") {
    retentionDays = 365;
    label = "Team 1-year retention limit";
  } else if (planCode === "BUSINESS") {
    retentionDays = 1095;
    label = "Business 3-year retention limit";
  } else if (planCode === "ENTERPRISE") {
    retentionDays = profile?.retentionWindowDays ?? 2555;
    label = `Enterprise ${retentionDays}-day retention limit`;
  }
  return [
    { id: `ret-${planCode.toLowerCase()}`, label, retentionDays, appliesTo: {}, exportable: true },
  ];
}

export async function getEvidenceRetentionPlan(
  workspaceId: string | null,
  tenantId: string,
): Promise<EvidenceRetentionPlan | null> {
  const evidence = await listRuntimeEvidence(workspaceId, tenantId);
  if (!evidence.length) return null;

  const profile = await getCommercialProfile(tenantId).catch(swallow("getCommercialProfile", null));
  const activeRules = resolveActiveRules(profile);

  return buildEvidenceRetentionPlan({
    id: `ret-${new Date().toISOString().slice(0, 7)}`,
    evidence,
    rules: activeRules,
    generatedAt: new Date().toISOString(),
    expiringWithinDays: DEFAULT_EXPIRING_WITHIN_DAYS,
  });
}

export async function pruneExpiredEvidence(
  workspaceId: string | null,
  tenantId: string,
  actorId = "system",
): Promise<{ prunedCount: number; prunedDecisionIds: string[] }> {
  return runWithTenantContext(tenantId, () =>
    pruneExpiredEvidenceInTenant(workspaceId, tenantId, actorId),
  );
}

async function pruneExpiredEvidenceInTenant(
  workspaceId: string | null,
  tenantId: string,
  actorId: string,
): Promise<{ prunedCount: number; prunedDecisionIds: string[] }> {
  const evidence = await listRuntimeEvidence(workspaceId, tenantId);
  if (!evidence.length) return { prunedCount: 0, prunedDecisionIds: [] };

  const profile = await getCommercialProfile(tenantId).catch(swallow("getCommercialProfile", null));
  const activeRules = resolveActiveRules(profile);

  const plan = buildEvidenceRetentionPlan({
    id: `prune-${new Date().toISOString()}`,
    evidence,
    rules: activeRules,
    generatedAt: new Date().toISOString(),
    expiringWithinDays: DEFAULT_EXPIRING_WITHIN_DAYS,
  });

  const expiredIds = plan.decisions
    .filter((d) => d.disposition === "EXPIRED")
    .map((d) => d.decisionId);

  if (!expiredIds.length) return { prunedCount: 0, prunedDecisionIds: [] };

  const prunedDecisionIds = await deleteExpiredEvidenceEvents(tenantId, workspaceId, expiredIds);

  appendOperationsLog({
    tenantId,
    workspaceId: workspaceId ?? undefined,
    eventType: "EVIDENCE_PRUNE",
    actorId,
    payload: {
      prunedCount: prunedDecisionIds.length,
      expiredCount: plan.expiredCount,
      generatedAt: plan.generatedAt,
    },
  }).catch(swallow("appendOperationsLog", undefined));

  return { prunedCount: prunedDecisionIds.length, prunedDecisionIds };
}

// GDPR Art. 17 (right to erasure): tombstones PII-bearing evidence content in
// place, preserving hash-chain linkage. Requires at least one filter so an
// erasure request is always an explicit, bounded action.
export async function eraseEvidencePii(
  workspaceId: string | null,
  tenantId: string,
  filters: EvidenceErasureFilters,
  actorId: string,
): Promise<{ erasedCount: number; erasedDecisionIds: string[] }> {
  if (!filters.decisionIds?.length && !filters.agentId && !filters.before) {
    return { erasedCount: 0, erasedDecisionIds: [] };
  }

  const { erasedDecisionIds } = await runWithTenantContext(tenantId, () =>
    eraseEvidencePiiEvents(tenantId, workspaceId, filters, actorId),
  );

  if (erasedDecisionIds.length) {
    appendOperationsLog({
      tenantId,
      workspaceId: workspaceId ?? undefined,
      eventType: "EVIDENCE_ERASURE",
      sourceTable: "runtime_evidence_event",
      actorId,
      payload: {
        erasedCount: erasedDecisionIds.length,
        agentId: filters.agentId,
        before: filters.before,
        decisionIdFilterCount: filters.decisionIds?.length ?? 0,
      },
    }).catch(swallow("appendOperationsLog", undefined));
  }

  return { erasedCount: erasedDecisionIds.length, erasedDecisionIds };
}

/**
 * Governance posture is owned by the posture domain. Domain services must not
 * import sibling domain services (see tests/domain-boundaries.test.mts), so the
 * app-layer caller injects the posture loader; the compliance aggregator stays
 * responsible only for resolving context and binding tenancy around it.
 */
export type PostureLoader<Posture> = (ctx: {
  tenantId: string;
  workspaceId: string;
  workspaceSlug: string;
}) => Promise<Posture>;

export interface CompliancePageModel<Posture = unknown> {
  workspaceContext: Awaited<ReturnType<typeof getWorkspaceContext>>;
  appViewMode: AppViewMode;
  packet: CompliancePacket | null;
  persistedRetentionPlan: EvidenceRetentionPlan | null;
  activeActor: Awaited<ReturnType<typeof getActiveActor>> | null;
  verificationSummary: Awaited<ReturnType<typeof getLatestVerificationStatus>> | null;
  grcDestinations: GrcDeliveryDestination[];
  grcDeliveryAttempts: Awaited<ReturnType<typeof listGrcDeliveryAttempts>>;
  posture: Posture;
  degraded: boolean;
}

export async function getCompliancePageModel<Posture>(params: {
  workspaceSlug?: string;
  loadPosture: PostureLoader<Posture>;
}): Promise<CompliancePageModel<Posture>> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: params.workspaceSlug });
  const appViewMode = await getAppViewMode();
  let degraded = false;
  const degrade =
    <T>(op: string, value: T) =>
    (error: unknown): T => {
      degraded = true;
      return swallow(op, value)(error);
    };

  const [
    packet,
    persistedRetentionPlan,
    activeActor,
    grcDestinations,
    grcDeliveryAttempts,
    posture,
  ] = await runWithTenantContext(workspaceContext.tenantId, () =>
    Promise.all([
      getCompliancePacket(workspaceContext.workspaceId, workspaceContext.tenantId).catch(
        degrade("getCompliancePacket", null),
      ),
      getEvidenceRetentionPlan(workspaceContext.workspaceId, workspaceContext.tenantId).catch(
        degrade("getEvidenceRetentionPlan", null),
      ),
      getActiveActor({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
      }).catch(degrade("getActiveActor", null)),
      listGrcDeliveryDestinations({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
      }).catch(degrade("listGrcDeliveryDestinations", [])),
      listGrcDeliveryAttempts({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
        limit: 5,
      }).catch(degrade("listGrcDeliveryAttempts", [])),
      params.loadPosture({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
        workspaceSlug: workspaceContext.workspaceSlug,
      }),
    ]),
  );

  const verificationSummary = packet?.export.artifact.artifactHash
    ? await runWithTenantContext(workspaceContext.tenantId, () =>
        getLatestVerificationStatus(workspaceContext.workspaceId, workspaceContext.tenantId, {
          artifactHash: packet.export.artifact.artifactHash,
        }),
      ).catch(degrade("runWithTenantContext", null))
    : null;

  return {
    workspaceContext,
    appViewMode,
    packet,
    persistedRetentionPlan,
    activeActor,
    verificationSummary,
    grcDestinations,
    grcDeliveryAttempts,
    posture,
    degraded,
  };
}
