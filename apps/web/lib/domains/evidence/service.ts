import { logger } from "@spctre/platform/logging";
import { getActiveActor } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  countRuntimeEvidence,
  getEvidenceSimulationRun,
  getSimulationRunReview,
  listRuntimeEvidence,
  listRuntimeEvidenceKeyset,
  listSimulationRuns,
  persistSimulationRun,
  type SimulationRunSummary,
} from "@/lib/repositories/evidence";
import { buildKeysetPage, decodeCursor } from "@/lib/pagination/keyset";
import { createTtlCache } from "@/lib/platform/ttl-cache";

// The evidence-list total is a display-only figure (finding 7 made the list
// keyset-paginated, so it no longer feeds offset math). Cache it briefly per
// tenant+workspace so rapid page views / refreshes don't each run a full
// workspace COUNT(*) across every partition. See database-optimizations-audit
// finding 5.
const evidenceCountCache = createTtlCache<number>({ ttlMs: 30_000 });
import {
  getGatewayOutcomesForDecisions,
  listResolvedEscalationsForRevision,
} from "@/lib/repositories/gateway";
import {
  getHighFrictionRules,
  getLatestPublishedBundle,
  getUnusedActiveRules,
  listBranches,
  type RuleHeatEntry,
  type UnusedRule,
} from "@/lib/repositories/policy";
import { listVerificationResults } from "@/lib/repositories/verification";
import { runWithTenantContext } from "@/lib/tenant-context";
import { recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { getEvidenceDemoFallbackData } from "@/lib/repositories/demo-fallbacks";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import {
  buildRuleControlMappingIndex,
  searchRuntimeDecisionEvidence,
  type PolicyBranch,
  type RuntimeDecisionEvidenceRecord,
  type RuntimeEvidenceSearchQuery,
  type SimulationRun,
} from "@spctre/policy-schema";

export type { SimulationRunSummary } from "@/lib/repositories/evidence";
export type { RuleHeatEntry, UnusedRule } from "@/lib/repositories/policy";


function emptySimulationRun(): SimulationRun {
  return {
    id: "no-simulation-run",
    branchId: "",
    revisionId: "",
    sourceEventCount: 0,
    createdBy: "",
    createdAt: new Date(0).toISOString(),
    results: [],
    newlyDeniedCount: 0,
    newlyAllowedCount: 0,
    unchangedCount: 0,
  };
}

export interface EvidenceControlMappingEntry {
  stableRuleId: string;
  framework: string;
  controlId: string;
  rationale?: string;
}

export interface EvidencePageModel {
  workspaceContext: Awaited<ReturnType<typeof getWorkspaceContext>>;
  evidence: RuntimeDecisionEvidenceRecord[];
  controlMappingIndex: EvidenceControlMappingEntry[];
  totalEvidenceCount: number;
  usingDb: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  searchResult: ReturnType<typeof searchRuntimeDecisionEvidence>;
  activeHeatmap: RuleHeatEntry[];
  activeUnused: UnusedRule[];
  maxDeny: number;
  filteredCount: number;
  denyCount: number;
  warnCount: number;
  allowCount: number;
  intentRiskPatterns: Array<{ intent: string; count: number }>;
}

export async function getEvidencePageModel({
  workspaceSlug,
  query,
  cursor,
  pageSize,
}: {
  workspaceSlug?: string;
  query: RuntimeEvidenceSearchQuery;
  cursor?: string;
  pageSize: number;
}): Promise<EvidencePageModel> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const { tenantId, workspaceId } = workspaceContext;
  const fallback = getEvidenceDemoFallbackData(tenantId);
  const decodedCursor = decodeCursor(cursor);

  let evidence = fallback.evidence;
  let totalEvidenceCount = evidence.length;
  let usingDb = false;
  let nextCursor: string | null = null;
  let prevCursor: string | null = null;
  let hasNext = false;
  let hasPrev = false;

  const dbResult = await runWithTenantContext(tenantId, () =>
    Promise.all([
      listRuntimeEvidenceKeyset(workspaceId, tenantId, pageSize, decodedCursor),
      evidenceCountCache.get(`${tenantId}:${workspaceId}`, () =>
        countRuntimeEvidence(workspaceId, tenantId)
      ),
    ])
  ).catch(() => null);

  if (dbResult) {
    const [keysetRows, dbTotal] = dbResult;
    if (keysetRows.length || dbTotal > 0) {
      const pageResult = buildKeysetPage(keysetRows, pageSize, decodedCursor, (row) => row.cursor);
      evidence = pageResult.items.map((row) => row.record);
      totalEvidenceCount = dbTotal;
      usingDb = true;
      nextCursor = pageResult.nextCursor;
      prevCursor = pageResult.prevCursor;
      hasNext = pageResult.hasNext;
      hasPrev = pageResult.hasPrev;
    }
  }

  const [heatmap, unusedRules, publishedBundle] = await runWithTenantContext(tenantId, () =>
    Promise.all([
      getHighFrictionRules(8, workspaceId, tenantId).catch(() => null),
      getUnusedActiveRules(workspaceId, tenantId).catch(() => null),
      getLatestPublishedBundle(workspaceId, tenantId).catch(() => null),
    ])
  );
  const controlMappingIndex = buildRuleControlMappingIndex(publishedBundle?.bundle.rules ?? []);

  const searchResult = searchRuntimeDecisionEvidence({ evidence, query });
  const activeHeatmap = heatmap ?? fallback.heatmap;
  const activeUnused = unusedRules ?? fallback.unusedRules;

  const intentCounts = new Map<string, number>();
  for (const e of evidence) {
    if ((e.status === "DENY" || e.status === "WARN") && e.toolIntent) {
      intentCounts.set(e.toolIntent, (intentCounts.get(e.toolIntent) || 0) + 1);
    }
  }
  const intentRiskPatterns = Array.from(intentCounts.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    workspaceContext,
    evidence,
    controlMappingIndex,
    totalEvidenceCount,
    usingDb,
    nextCursor,
    prevCursor,
    hasNext,
    hasPrev,
    searchResult,
    activeHeatmap,
    activeUnused,
    maxDeny: Math.max(...activeHeatmap.map((entry) => entry.denyCount), 1),
    filteredCount: searchResult.results.length,
    denyCount: evidence.filter((entry) => entry.status === "DENY").length,
    warnCount: evidence.filter((entry) => entry.status === "WARN").length,
    allowCount: evidence.filter((entry) => entry.status === "ALLOW").length,
    intentRiskPatterns,
  };
}

export interface SimulationPageModel {
  workspaceContext: Awaited<ReturnType<typeof getWorkspaceContext>>;
  activeSimulationRun: SimulationRun;
  branches: PolicyBranch[];
  simulationHistory: SimulationRunSummary[] | null;
  activeHeatmap: RuleHeatEntry[];
}

export async function getSimulationPageModel({
  workspaceSlug,
  simBranchId,
  simRevisionId,
  simRunId,
}: {
  workspaceSlug?: string;
  simBranchId?: string;
  simRevisionId?: string;
  simRunId?: string;
}): Promise<SimulationPageModel> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const { tenantId, workspaceId } = workspaceContext;
  const fallback = getEvidenceDemoFallbackData(tenantId);

  const savedRun = simRunId && isSimulationRunId(simRunId)
    ? await runWithTenantContext(tenantId, () =>
      getSimulationRunReview({ tenantId, workspaceId, simulationRunId: simRunId }).catch(() => null)
    )
    : null;

  const [generatedSimulationRun, heatmap, branches, simulationHistory] = await runWithTenantContext(tenantId, () =>
    Promise.all([
      savedRun ? Promise.resolve(null) : getEvidenceSimulationRun(simBranchId, simRevisionId, workspaceId, tenantId, "system", { allowBulk: false }).catch(() => null),
      getHighFrictionRules(8, workspaceId, tenantId).catch(() => null),
      listBranches(workspaceId, tenantId).catch(() => []),
      listSimulationRuns(workspaceId, tenantId).catch(() => null),
    ])
  );

  return {
    workspaceContext,
    activeSimulationRun: savedRun ? simulationRunFromReview(savedRun) : generatedSimulationRun ?? fallback.simulationRun ?? emptySimulationRun(),
    branches,
    simulationHistory,
    activeHeatmap: heatmap ?? fallback.heatmap,
  };
}

function isSimulationRunId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function simulationRunFromReview(review: NonNullable<Awaited<ReturnType<typeof getSimulationRunReview>>>): SimulationRun {
  return {
    id: review.id,
    branchId: review.branchId,
    revisionId: review.revisionId,
    sourceEventCount: review.sourceEventCount,
    createdBy: review.createdBy,
    createdAt: review.createdAt,
    results: review.findings,
    newlyDeniedCount: review.newlyDeniedCount,
    newlyAllowedCount: review.newlyAllowedCount,
    unchangedCount: review.unchangedCount,
    regressionSummary: review.regressionSummary ?? undefined,
  };
}

export async function listEvidenceForExport(params: {
  workspaceId: string;
  tenantId: string;
  limit: number;
  offset: number;
}) {
  return listRuntimeEvidence(params.workspaceId, params.tenantId, params.limit, params.offset);
}

export async function getAgtVerificationExportInputs(params: {
  workspaceId: string;
  tenantId: string;
}) {
  const published = await getLatestPublishedBundle(params.workspaceId, params.tenantId);
  if (!published) return null;

  const escalations = await listResolvedEscalationsForRevision(
    published.revisionId,
    params.tenantId
  ).catch(() => []);
  const verificationResults = await listVerificationResults(
    params.workspaceId,
    params.tenantId,
    {
      revisionId: published.revisionId,
      artifactHash: published.artifactHash,
      limit: 25,
    }
  ).catch(() => []);

  return { published, escalations, verificationResults };
}

export async function getGatewayOutcomeMapForEvidence(params: {
  tenantId: string;
  workspaceId: string;
  decisionIds: string[];
}) {
  return getGatewayOutcomesForDecisions(params.tenantId, params.workspaceId, params.decisionIds);
}

export type RunSimulationResult =
  | { newlyDenied: number; newlyAllowed: number; unchanged: number; total: number; branchId: string; revisionId: string; runId: string }
  | { error: string };

export async function runSimulationDecision(input: {
  branchId: string;
  revisionId: string;
}): Promise<RunSimulationResult> {
  const started = Date.now();
  return await withSpan("evidence.simulation.run", { "spctre.branch_id": input.branchId, "spctre.revision_id": input.revisionId }, async (span) => {
  const workspaceContext = await getWorkspaceContext().catch(() => null);
  if (!workspaceContext) {
    recordDuration("spctre.evidence.simulation.duration", Date.now() - started, { outcome: "missing_workspace_context" });
    return { error: "Workspace context unavailable." };
  }
  const { workspaceId, tenantId } = workspaceContext;

  try {
    const { actor } = await getActiveActor({ workspaceId, tenantId }).catch(() => ({
      actor: { id: "system", name: "system" },
    }));

    const run = await getEvidenceSimulationRun(
      input.branchId || undefined,
      input.revisionId || undefined,
      workspaceId,
      tenantId,
      actor.id,
      { allowBulk: isFeatureEnabledForPlan("bulkProductionSimulation", getSpctrePlan()) }
    );
    if (!run) {
      recordDuration("spctre.evidence.simulation.duration", Date.now() - started, { outcome: "empty" });
      return { error: "No evidence or revision data available to simulate against." };
    }

    const persistedRunId = await persistSimulationRun(run, workspaceId, tenantId).catch(() => null);
    appendOperationsLog({
      tenantId,
      workspaceId,
      eventType: "SIMULATION_RUN",
      sourceId: persistedRunId ?? run.id,
      sourceTable: "simulation_run",
      actorId: actor.id,
      payload: {
        branchId: run.branchId,
        revisionId: run.revisionId,
        simulationRunId: persistedRunId,
        sourceEventCount: run.sourceEventCount,
        newlyDeniedCount: run.newlyDeniedCount,
        newlyAllowedCount: run.newlyAllowedCount,
        unchangedCount: run.unchangedCount,
        regressionSummary: run.regressionSummary,
        sampledEventIds: run.results.slice(0, 10).map((result) => result.eventId),
      },
    }).catch(() => {});

    span.setAttributes({
      "spctre.simulation.total": run.sourceEventCount,
      "spctre.simulation.newly_denied": run.newlyDeniedCount,
      "spctre.simulation.newly_allowed": run.newlyAllowedCount,
    });
    recordDuration("spctre.evidence.simulation.duration", Date.now() - started, { outcome: "success" });
    return {
      newlyDenied: run.newlyDeniedCount,
      newlyAllowed: run.newlyAllowedCount,
      unchanged: run.unchangedCount,
      total: run.sourceEventCount,
      branchId: run.branchId,
      revisionId: run.revisionId,
      runId: persistedRunId ?? run.id,
    };
  } catch (error) {
    logger.error("[runSimulationDecision] error:", { error: error instanceof Error ? error.message : String(error) });
    recordDuration("spctre.evidence.simulation.duration", Date.now() - started, { outcome: "error" });
    return { error: "An unexpected error occurred during simulation." };
  }
  });
}
