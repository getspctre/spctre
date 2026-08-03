import { logger } from "@spctre/platform/logging";
import { evaluatePublishReadiness } from "@spctre/policy-schema";
import type { PolicyApprovalRule } from "@spctre/policy-schema";
import { REQUIRED_APPROVAL_RULES } from "@/lib/approval-config";
import { getBranchPermissions, getActiveActor } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { canUseDemoFallbackData } from "@/lib/demo-guard";
import {
  getApprovals,
  getReviewArtifacts,
  listBranches,
  listBranchRevisions,
  getRulesForRevision,
  getBlastRadius,
  getBundleCompatibilityReport,
} from "@/lib/repositories/policy";
import { approvalRulesFromWorkflow, getApprovalWorkflowForContext } from "@/lib/repositories/approval-workflow";
import { getLatestVerificationStatus } from "@/lib/repositories/verification";
import { getLatestManagedSimulationRegression } from "@/lib/repositories/evidence";
import { getAuthoringVocabulary, listAdapterDeclarationsForWorkspace, type AuthoringVocabularyEntry } from "@/lib/domains/packs/service";
import type { EnforcementCoverage } from "@/lib/policy/rule-enforcement";
import type { SimulationRegressionSummary } from "@spctre/policy-schema";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { swallow } from "@/lib/platform/swallow";

/**
 * Presentation loader for the review route. This assembles the read-model the
 * review (and author) pages render. It lives next to the route — not in the
 * domain layer — because it is a presentation concern: it stitches together
 * demo fallbacks, CSS pill classes, and diff summaries that only the UI cares
 * about. Domain services stay free of this presentation glue.
 */

// View-model types derived from the repository functions this loader calls, so
// they stay in sync with the data source without re-declaring domain shapes.
type ReviewWorkspaceContext = Awaited<ReturnType<typeof getWorkspaceContext>>;
type Actor = Awaited<ReturnType<typeof getActiveActor>>["actor"];
type Branch = Awaited<ReturnType<typeof listBranches>>[number];
type Approval = Awaited<ReturnType<typeof getApprovals>>[number];
type ReviewArtifactsModel = NonNullable<Awaited<ReturnType<typeof getReviewArtifacts>>>;
type BranchRevision = Awaited<ReturnType<typeof listBranchRevisions>>[number];
type RevisionRule = Awaited<ReturnType<typeof getRulesForRevision>>[number];
type BlastRadius = Awaited<ReturnType<typeof getBlastRadius>>;
type CompatibilityReport = Awaited<ReturnType<typeof getBundleCompatibilityReport>>;
type ApprovalWorkflow = Awaited<ReturnType<typeof getApprovalWorkflowForContext>>;
type VerificationSummary = Awaited<ReturnType<typeof getLatestVerificationStatus>>;
type BranchPermissions = ReturnType<typeof getBranchPermissions>;
type Readiness = ReturnType<typeof evaluatePublishReadiness>;

// The four review artifacts, split out so demo fallbacks can be typed per-field.
type Composition = ReviewArtifactsModel["composition"];
type RevisionDiff = ReviewArtifactsModel["diff"];
type ArtifactExport = ReviewArtifactsModel["artifact"];
type PolicyBundle = ReviewArtifactsModel["bundle"];
type VerificationPolicy = NonNullable<ApprovalWorkflow["verificationPolicy"]>;

export interface ReviewPageModel {
  workspaceContext: ReviewWorkspaceContext;
  appViewMode: Awaited<ReturnType<typeof getAppViewMode>>;
  actor: Actor;
  branches: Branch[];
  activeBranch: Branch | undefined;
  requestedBranchUnavailable: boolean;
  usingRealBranch: boolean;
  approvals: Approval[];
  reviewArtifacts: ReviewArtifactsModel | null;
  revisions: BranchRevision[];
  activeRevisionRules: RevisionRule[];
  blastRadius: BlastRadius;
  compatibilityReport: CompatibilityReport | null;
  approvalWorkflow: ApprovalWorkflow | null;
  verificationSummary: VerificationSummary | null;
  simulationRegression: SimulationRegressionSummary | null;
  requiresManagedSimulation: boolean;
  readiness: Readiness;
  isPublished: boolean;
  approvedRequiredCount: number;
  diffSummary: { added: number; modified: number; removed: number; unchanged: number };
  changedRuleCount: number;
  readinessPillClass: string;
  permissions: BranchPermissions;
  changedRuleIds: string[];
  activeComposition: Composition | null;
  activeDiff: RevisionDiff | null;
  activeArtifact: ArtifactExport | null;
  activeBundle: PolicyBundle | null;
  approvalRules: PolicyApprovalRule[];
  authoringVocabulary: AuthoringVocabularyEntry[];
  enforcementCoverage: EnforcementCoverage;
}

// Load branches from the database, degrading to the demo/empty fallback.
async function resolveReviewBranches(
  workspaceContext: ReviewWorkspaceContext,
  fallback: Branch[]
): Promise<Branch[]> {
  let branches = fallback;
  try {
    const dbBranches = await listBranches(workspaceContext.workspaceId, workspaceContext.tenantId);
    if (dbBranches.length) branches = dbBranches;
  } catch (err) {
    // Degrade to the demo/empty branch list, but keep the failure visible:
    // this catch also swallows query and RLS errors, not just "no database".
    logger.warn("Review page branch query failed; using fallback data", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return branches;
}

// Approvals, artifacts, revisions, and rules for the active revision.
async function loadActiveRevisionData(
  workspaceContext: ReviewWorkspaceContext,
  activeBranch: Branch | undefined,
  usingRealBranch: boolean
): Promise<[Approval[], ReviewArtifactsModel | null, BranchRevision[], RevisionRule[]]> {
  if (!usingRealBranch || !activeBranch?.activeRevision) {
    return [[], null, [], []];
  }
  return Promise.all([
    getApprovals(activeBranch.activeRevision, workspaceContext.tenantId).catch(swallow("getApprovals", [])),
    getReviewArtifacts(
      activeBranch.id,
      activeBranch.activeRevision,
      workspaceContext.workspaceId,
      workspaceContext.tenantId
    ).catch(swallow("getReviewArtifacts", null)),
    listBranchRevisions(
      activeBranch.id,
      workspaceContext.workspaceId,
      workspaceContext.tenantId
    ).catch(swallow("listBranchRevisions", [])),
    getRulesForRevision(activeBranch.activeRevision, workspaceContext.tenantId).catch(swallow("getRulesForRevision", []))
  ]);
}

// Blast radius, bundle compatibility, and approval workflow for the branch.
async function loadReviewAugments(
  workspaceContext: ReviewWorkspaceContext,
  activeBranch: Branch | undefined,
  usingRealBranch: boolean,
  changedRuleIds: string[],
  activeBundle: PolicyBundle | null
): Promise<[BlastRadius, CompatibilityReport | null, ApprovalWorkflow | null]> {
  return Promise.all([
    usingRealBranch && changedRuleIds.length > 0
      ? getBlastRadius(changedRuleIds, workspaceContext.workspaceId, workspaceContext.tenantId).catch(swallow("getBlastRadius", null))
      : Promise.resolve(null),
    usingRealBranch && activeBundle
      ? getBundleCompatibilityReport(activeBundle, workspaceContext.workspaceId, workspaceContext.tenantId).catch(swallow("getBundleCompatibilityReport", null))
      : Promise.resolve(null),
    usingRealBranch && activeBranch
      ? getApprovalWorkflowForContext({
          tenantId: workspaceContext.tenantId,
          workspaceId: workspaceContext.workspaceId,
          environment: activeBranch.environment ?? null,
        }).catch(swallow("getApprovalWorkflowForContext", null))
      : Promise.resolve(null),
  ]);
}

// Pick DB-backed artifacts, falling back to demo mocks in demo workspaces.
function resolveActiveArtifacts(
  reviewArtifacts: ReviewArtifactsModel | null,
  useDemoFallbackData: boolean,
  mocks: { compositionPreview: Composition; revisionDiff: RevisionDiff; artifactExport: ArtifactExport; agtBundlePreview: PolicyBundle }
) {
  const activeComposition: Composition | null = reviewArtifacts?.composition ?? (useDemoFallbackData ? mocks.compositionPreview : null);
  const activeDiff: RevisionDiff | null = reviewArtifacts?.diff ?? (useDemoFallbackData ? mocks.revisionDiff : null);
  const activeArtifact: ArtifactExport | null = reviewArtifacts?.artifact ?? (useDemoFallbackData ? mocks.artifactExport : null);
  const activeBundle: PolicyBundle | null = reviewArtifacts?.bundle ?? (useDemoFallbackData ? mocks.agtBundlePreview : null);

  const changedRuleIds: string[] = activeDiff?.rules
    .filter((r) => r.status === "ADDED" || r.status === "MODIFIED")
    .map((r) => r.stableRuleId) ?? [];

  return { activeComposition, activeDiff, activeArtifact, activeBundle, changedRuleIds };
}

// Publish-readiness plus the derived counters and pill class the page renders.
function computeReadinessView(params: {
  activeBranch: Branch | undefined;
  approvalRules: PolicyApprovalRule[];
  approvals: Approval[];
  verificationSummary: VerificationSummary | null;
  verificationPolicy: VerificationPolicy;
  approvalWorkflow: ApprovalWorkflow | null;
  activeDiff: RevisionDiff | null;
}) {
  const { activeBranch, approvals, activeDiff } = params;
  const readiness = evaluatePublishReadiness({
    branchId: activeBranch?.id ?? "",
    revisionId: activeBranch?.activeRevision ?? "",
    approvalRules: params.approvalRules,
    approvals,
    verificationSummary: params.verificationSummary ?? undefined,
    verificationPolicy: params.verificationPolicy,
    approvalWorkflow: params.approvalWorkflow ?? undefined,
  });

  const isPublished = activeBranch?.status === "PUBLISHED";
  const approvedRequiredCount = approvals.filter((a) => a.status === "APPROVED").length;
  const emptyDiffSummary = { added: 0, modified: 0, removed: 0, unchanged: 0 };
  const diffSummary = activeDiff?.summary ?? emptyDiffSummary;
  const changedRuleCount = diffSummary.added + diffSummary.modified + diffSummary.removed;
  const readinessPillClass =
    isPublished
      ? "pill pillAllow"
      : readiness.status === "READY"
        ? "pill pillAllow"
        : "pill pillWarn";

  return { readiness, isPublished, approvedRequiredCount, diffSummary, changedRuleCount, readinessPillClass };
}

function resolveBranchPermissions(
  actor: Actor,
  activeBranch: Branch | undefined,
  workspaceSlug: string
): BranchPermissions {
  return activeBranch
    ? getBranchPermissions({
        actor,
        branch: activeBranch,
        workspaceSlug
      })
    : {
        canPublish: false,
        publishReason: "Select a branch to publish.",
        reviewableRoles: [],
        reviewBlockedReason: "Select a branch to review."
      };
}

export async function getReviewPageModel({
  workspaceSlug,
  selectedBranchId,
}: {
  workspaceSlug?: string;
  selectedBranchId?: string;
}): Promise<ReviewPageModel> {
  const {
    branches: mockBranches,
    compositionPreview,
    revisionDiff,
    artifactExport,
    agtBundlePreview,
  } = await import("@/lib/mock-data");

  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const appViewMode = await getAppViewMode();
  const { actor } = await getActiveActor({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId
  });

  const useDemoFallbackData = canUseDemoFallbackData(workspaceContext.tenantId);
  const branches = await resolveReviewBranches(workspaceContext, useDemoFallbackData ? mockBranches : []);

  const requestedBranchUnavailable = Boolean(selectedBranchId) && !branches.some((branch) => branch.id === selectedBranchId);
  const activeBranch = requestedBranchUnavailable
    ? undefined
    : branches.find((branch) => branch.id === selectedBranchId) ??
      branches.find((branch) => branch.status !== "PUBLISHED") ??
      branches[0];

  const usingRealBranch = branches !== mockBranches && !!activeBranch;

  const [approvals, reviewArtifacts, revisions, activeRevisionRules] =
    await loadActiveRevisionData(workspaceContext, activeBranch, usingRealBranch);

  const { activeComposition, activeDiff, activeArtifact, activeBundle, changedRuleIds } =
    resolveActiveArtifacts(reviewArtifacts, useDemoFallbackData && !requestedBranchUnavailable, {
      compositionPreview,
      revisionDiff,
      artifactExport,
      agtBundlePreview,
    });

  const [blastRadius, compatibilityReport, approvalWorkflow] =
    await loadReviewAugments(workspaceContext, activeBranch, usingRealBranch, changedRuleIds, activeBundle);

  const approvalRules = approvalWorkflow ? approvalRulesFromWorkflow(approvalWorkflow) : REQUIRED_APPROVAL_RULES;
  const verificationPolicy = approvalWorkflow?.verificationPolicy ?? { requireVerification: false };
  const verificationRequired = verificationPolicy.requireVerification === true;
  const verificationSummary = usingRealBranch && activeBranch?.activeRevision && activeArtifact && verificationRequired
    ? await getLatestVerificationStatus(workspaceContext.workspaceId, workspaceContext.tenantId, {
        revisionId: activeBranch.activeRevision,
        artifactHash: activeArtifact.artifactHash,
      }).catch(swallow("getLatestVerificationStatus", null))
    : null;
  const requiresManagedSimulation = usingRealBranch && Boolean(activeBranch?.activeRevision) && isFeatureEnabledForPlan("bulkProductionSimulation", getSpctrePlan());
  const simulationRegression = usingRealBranch && activeBranch?.activeRevision
    ? await getLatestManagedSimulationRegression({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
        revisionId: activeBranch.activeRevision,
      }).catch(swallow("getLatestManagedSimulationRegression", null))
    : null;

  const { readiness, isPublished, approvedRequiredCount, diffSummary, changedRuleCount, readinessPillClass } =
    computeReadinessView({
      activeBranch,
      approvalRules,
      approvals,
      verificationSummary,
      verificationPolicy,
      approvalWorkflow,
      activeDiff,
    });
  const permissions = resolveBranchPermissions(actor, activeBranch, workspaceContext.workspaceSlug);

  const [authoringVocabulary, adapters] = usingRealBranch
    ? await Promise.all([
        getAuthoringVocabulary({
          workspaceId: workspaceContext.workspaceId,
          tenantId: workspaceContext.tenantId,
        }).catch(swallow("getAuthoringVocabulary", [])),
        listAdapterDeclarationsForWorkspace({
          workspaceId: workspaceContext.workspaceId,
          tenantId: workspaceContext.tenantId,
        }).catch(swallow("listAdapterDeclarationsForWorkspace", [])),
      ])
    : [[], []];

  const enforcementCoverage: EnforcementCoverage = {
    adapterCount: adapters.length,
    coveredConnectors: Array.from(new Set(adapters.flatMap((adapter) => adapter.supportedConnectors ?? []))),
  };

  return {
    workspaceContext,
    appViewMode,
    actor,
    branches,
    activeBranch,
    requestedBranchUnavailable,
    usingRealBranch,
    approvals,
    reviewArtifacts,
    revisions,
    activeRevisionRules,
    blastRadius,
    compatibilityReport,
    approvalWorkflow,
    verificationSummary,
    simulationRegression,
    requiresManagedSimulation,
    readiness,
    isPublished,
    approvedRequiredCount,
    diffSummary,
    changedRuleCount,
    readinessPillClass,
    permissions,
    changedRuleIds,
    activeComposition,
    activeDiff,
    activeArtifact,
    activeBundle,
    approvalRules,
    authoringVocabulary,
    enforcementCoverage,
  };
}
