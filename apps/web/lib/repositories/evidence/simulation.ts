import { logger } from "@spctre/platform/logging";
import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import {
  buildSimulationRegressionSummary,
  buildSimulationRun,
  evaluateDecision,
} from "@spctre/policy-schema";
import { isFeatureEnabledForPlan } from "@/lib/feature-flags";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { bulkSimulationService } from "@/lib/ee-adapters/simulation";
import type {
  PolicyRuleSummary,
  SimulationReplayInput,
  SimulationRegressionSummary,
  SimulationRun,
} from "@spctre/policy-schema";
import { listRulesForRevision } from "@/lib/repositories/shared/rules";
import {
  getLatestRevisionMetadata,
  getLatestRevisionMetadataForBranch,
  getRevisionMetadata,
  revisionBelongsToWorkspace,
  type RevisionMetadata,
} from "@/lib/repositories/shared/revisions";
import { listRuntimeEvidence } from "./runtime";
import { swallow } from "@/lib/platform/swallow";

// Premium bulk-simulation details attached for the Cloud UI reports; optional so
// the local-sample fallback (a plain SimulationRun) still satisfies the type.
export interface SimulationRunWithBulkDetails extends SimulationRun {
  totalCostSavedUsd?: number;
  totalLatencySavedMs?: number;
  averageLatencySavedMs?: number;
}

function isKnownHighRiskOutcome(record: Awaited<ReturnType<typeof listRuntimeEvidence>>[number]): boolean {
  const raw = record.rawEvidence;
  const risk = typeof raw.riskLevel === "string" ? raw.riskLevel : raw.risk_level;
  const consequence = record.toolParameters?.consequenceTier ?? record.toolParameters?.consequence_tier;
  return risk === "HIGH" || risk === "CRITICAL" || consequence === "HIGH" || consequence === "CRITICAL";
}

export async function getEvidenceSimulationRun(
  branchId: string | undefined,
  revisionId: string | undefined,
  workspaceId: string | null,
  tenantId: string,
  createdBy = "system",
  options: { allowBulk?: boolean } = {}
): Promise<SimulationRunWithBulkDetails | null> {
  const evidence = await listRuntimeEvidence(workspaceId, tenantId);
  if (!evidence.length) return null;

  let revision: RevisionMetadata | null = null;
  if (revisionId) {
    revision = await getRevisionMetadata(revisionId, tenantId).catch(swallow("getRevisionMetadata", null));
    if (revision && branchId && revision.branchId !== branchId) {
      revision = null;
    }
    if (revision && !(await revisionBelongsToWorkspace(revision.revisionId, workspaceId, tenantId))) {
      revision = null;
    }
  } else if (branchId) {
    revision = await getLatestRevisionMetadataForBranch(branchId, workspaceId, tenantId)
      .catch(swallow("getLatestRevisionMetadataForBranch", null));
  } else {
    revision = await getLatestRevisionMetadata(workspaceId, tenantId);
  }
  if (!revision) return null;

  const proposedRules = await listRulesForRevision(revision.revisionId, tenantId).catch(swallow("listRulesForRevision", [] as PolicyRuleSummary[]));

  const plan = getSpctrePlan();
  if (options.allowBulk && isFeatureEnabledForPlan("bulkProductionSimulation", plan)) {
    try {
      const bulkResult = await bulkSimulationService.runBulkSimulation({
        tenantId,
        workspaceId,
        proposedRules
      });

      const simRun = buildSimulationRun({
        id: `sim-${revision.revisionId.slice(0, 8)}-${Date.now().toString(36)}`,
        branchId: revision.branchId,
        revisionId: revision.revisionId,
        sourceEventCount: bulkResult.sourceEventCount,
        createdBy,
        createdAt: new Date().toISOString(),
        results: bulkResult.results
      });

      // Attach premium cost and latency details for the Cloud UI reports
      return {
        ...simRun,
        totalCostSavedUsd: bulkResult.totalCostSavedUsd,
        totalLatencySavedMs: bulkResult.totalLatencySavedMs,
        averageLatencySavedMs: bulkResult.averageLatencySavedMs,
        newlyDeniedCount: bulkResult.newlyDeniedCount,
        newlyAllowedCount: bulkResult.newlyAllowedCount,
        unchangedCount: bulkResult.unchangedCount,
        regressionSummary: bulkResult.regressionSummary
          ? bulkResult.regressionSummary
          : buildSimulationRegressionSummary({ results: bulkResult.results, coverage: "SAMPLED" }),
      };
    } catch (err) {
      logger.warn("[Bulk Simulation Fallback] Parallel simulation failed, falling back to local sample.", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const SIMULATION_SAMPLE_SIZE = 20;
  const highRiskEventIds = new Set(evidence.filter(isKnownHighRiskOutcome).map((record) => record.decisionId));
  const results: SimulationReplayInput[] = evidence.slice(0, SIMULATION_SAMPLE_SIZE).map((record) => {
    const previousStatus = record.status;
    const evalResult = evaluateDecision({
      connector: record.connector,
      action: record.action,
      domains: record.policyRefs,
      rules: proposedRules,
      toolIntent: record.toolIntent,
      planSummary: record.planSummary,
      toolParameters: record.toolParameters,
    });
    const proposedStatus = evalResult.status;
    const delta: SimulationReplayInput["delta"] =
      previousStatus === proposedStatus
        ? "UNCHANGED"
        : previousStatus !== "DENY" && proposedStatus === "DENY"
          ? "NEW_DENY"
          : previousStatus === "DENY" && proposedStatus !== "DENY"
            ? "NEW_ALLOW"
            : "MODIFIED";
    return {
      eventId: record.decisionId,
      connector: record.connector,
      action: record.action,
      previousStatus,
      proposedStatus,
      delta,
      matchedPolicyRefs: evalResult.matchedRefs.length ? evalResult.matchedRefs : record.policyRefs,
      reason: evalResult.reason,
    };
  });

  return buildSimulationRun({
    id: `sim-${revision.revisionId.slice(0, 8)}-${Date.now().toString(36)}`,
    branchId: revision.branchId,
    revisionId: revision.revisionId,
    sourceEventCount: evidence.length,
    createdBy,
    createdAt: new Date().toISOString(),
    results,
    regressionSummary: buildSimulationRegressionSummary({
      results,
      highRiskEventIds,
      coverage: "SAMPLED",
    }),
  });
}

export async function persistSimulationRun(
  run: SimulationRun,
  workspaceId: string | null,
  tenantId: string
): Promise<string | null> {
  if (!sql) return null;
  await ensureDemoTenant();
  const findings = run.results.map((result) => ({
    event_id: result.eventId,
    connector: result.connector,
    action: result.action,
    previous_status: result.previousStatus,
    proposed_status: result.proposedStatus,
    delta: result.delta,
    matched_policy_refs: result.matchedPolicyRefs,
    reason: result.reason,
  }));
  return sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO simulation_run (
        tenant_id, workspace_id, branch_id, revision_id,
        source_event_count, newly_denied_count, newly_allowed_count, unchanged_count,
        regression_summary, replay_coverage, created_by
      ) VALUES (
        ${tenantId}, ${workspaceId}, ${run.branchId}, ${run.revisionId},
        ${run.sourceEventCount}, ${run.newlyDeniedCount}, ${run.newlyAllowedCount},
        ${run.unchangedCount}, ${tx.json((run.regressionSummary ?? null) as JSONValue)}::jsonb,
        ${run.regressionSummary?.coverage ?? "SAMPLED"}, ${run.createdBy}
      )
      RETURNING id::text AS id
    `;
    const simulationRunId = inserted[0]?.id;
    if (!simulationRunId) return null;

    if (findings.length) {
      await tx`
        INSERT INTO simulation_replay_finding (
          simulation_run_id, tenant_id, workspace_id, event_id, connector, action,
          previous_status, proposed_status, delta, matched_policy_refs, reason
        )
        SELECT
          ${simulationRunId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid,
          finding.event_id, finding.connector, finding.action,
          finding.previous_status, finding.proposed_status, finding.delta,
          finding.matched_policy_refs, finding.reason
        FROM jsonb_to_recordset(${tx.json(findings)}::jsonb) AS finding(
          event_id text,
          connector text,
          action text,
          previous_status text,
          proposed_status text,
          delta text,
          matched_policy_refs text[],
          reason text
        )
      `;
    }
    return simulationRunId;
  });
}

export async function getLatestManagedSimulationRegression(params: {
  tenantId: string;
  workspaceId: string | null;
  revisionId: string;
}): Promise<SimulationRegressionSummary | null> {
  if (!sql) return null;
  const rows = await sql<{ regression_summary: unknown }[]>`
    SELECT regression_summary
    FROM simulation_run
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id IS NOT DISTINCT FROM ${params.workspaceId}
      AND revision_id = ${params.revisionId}
      AND replay_coverage IN ('RETAINED_LOG', 'SAMPLED')
      AND regression_summary IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return parseRegressionSummary(rows[0]?.regression_summary);
}

function parseRegressionSummary(summary: unknown): SimulationRegressionSummary | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const value = summary as Record<string, unknown>;
  if (value.coverage !== "RETAINED_LOG" && value.coverage !== "SAMPLED") return null;
  const fields = [
    "newlyDeniedExpectedWorkCount",
    "removedEscalationCoverageCount",
    "newlyAllowedHighRiskCount",
    "blockingCount",
  ];
  if (fields.some((field) => typeof value[field] !== "number")) return null;
  return value as unknown as SimulationRegressionSummary;
}

export interface SimulationReplayFinding {
  eventId: string;
  connector: string;
  action: string;
  previousStatus: SimulationReplayInput["previousStatus"];
  proposedStatus: SimulationReplayInput["proposedStatus"];
  delta: SimulationReplayInput["delta"];
  matchedPolicyRefs: string[];
  reason: string;
}

export async function listSimulationReplayFindings(params: {
  tenantId: string;
  workspaceId: string | null;
  simulationRunId: string;
  limit?: number;
}): Promise<SimulationReplayFinding[]> {
  if (!sql) return [];
  const rows = await sql<{
    event_id: string;
    connector: string;
    action: string;
    previous_status: SimulationReplayInput["previousStatus"];
    proposed_status: SimulationReplayInput["proposedStatus"];
    delta: SimulationReplayInput["delta"];
    matched_policy_refs: string[];
    reason: string;
  }[]>`
    SELECT event_id, connector, action, previous_status, proposed_status, delta, matched_policy_refs, reason
    FROM simulation_replay_finding
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id IS NOT DISTINCT FROM ${params.workspaceId}
      AND simulation_run_id = ${params.simulationRunId}::uuid
    ORDER BY created_at ASC
    LIMIT ${Math.min(Math.max(params.limit ?? 1000, 1), 1000)}
  `;
  return rows.map((row) => ({
    eventId: row.event_id,
    connector: row.connector,
    action: row.action,
    previousStatus: row.previous_status,
    proposedStatus: row.proposed_status,
    delta: row.delta,
    matchedPolicyRefs: row.matched_policy_refs,
    reason: row.reason,
  }));
}

export async function getSimulationRunReview(params: {
  tenantId: string;
  workspaceId: string | null;
  simulationRunId: string;
}): Promise<(SimulationRunSummary & { findings: SimulationReplayFinding[] }) | null> {
  if (!sql) return null;
  const rows = await sql<{
    id: string;
    branch_id: string;
    revision_id: string;
    branch_name: string | null;
    source_event_count: number;
    newly_denied_count: number;
    newly_allowed_count: number;
    unchanged_count: number;
    regression_summary: unknown;
    created_by: string;
    created_by_email: string | null;
    created_at: Date;
  }[]>`
    SELECT
      sr.id::text, sr.branch_id, sr.revision_id, pb.name AS branch_name,
      sr.source_event_count, sr.newly_denied_count, sr.newly_allowed_count,
      sr.unchanged_count, sr.regression_summary, sr.created_by,
      COALESCE(author.display_name, author.email) AS created_by_email, sr.created_at
    FROM simulation_run sr
    LEFT JOIN policy_branch pb ON pb.id = sr.branch_id AND pb.tenant_id = sr.tenant_id
    LEFT JOIN app_principal author ON author.id::text = sr.created_by AND author.tenant_id = sr.tenant_id
    WHERE sr.tenant_id = ${params.tenantId}
      AND sr.workspace_id IS NOT DISTINCT FROM ${params.workspaceId}
      AND sr.id = ${params.simulationRunId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const findings = await listSimulationReplayFindings(params);
  return {
    id: row.id,
    branchId: row.branch_id,
    revisionId: row.revision_id,
    branchName: row.branch_name,
    sourceEventCount: row.source_event_count,
    newlyDeniedCount: row.newly_denied_count,
    newlyAllowedCount: row.newly_allowed_count,
    unchangedCount: row.unchanged_count,
    regressionSummary: parseRegressionSummary(row.regression_summary),
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at.toISOString(),
    findings,
  };
}

export interface SimulationRunSummary {
  id: string;
  branchId: string;
  revisionId: string;
  branchName: string | null;
  sourceEventCount: number;
  newlyDeniedCount: number;
  newlyAllowedCount: number;
  unchangedCount: number;
  regressionSummary: SimulationRegressionSummary | null;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: string;
}

export async function listSimulationRuns(
  workspaceId: string | null,
  tenantId: string,
  limit = 20
): Promise<SimulationRunSummary[]> {
  try {
    const rows = await sql<
      {
        id: string;
        branch_id: string;
        revision_id: string;
        branch_name: string | null;
        source_event_count: number;
        newly_denied_count: number;
        newly_allowed_count: number;
        unchanged_count: number;
        regression_summary: unknown;
        created_by: string;
        created_by_email: string | null;
        created_at: Date;
      }[]
    >`
      SELECT
        sr.id, sr.branch_id, sr.revision_id, pb.name AS branch_name,
        sr.source_event_count, sr.newly_denied_count, sr.newly_allowed_count,
        sr.unchanged_count, sr.regression_summary, sr.created_by,
        COALESCE(author.display_name, author.email) AS created_by_email,
        sr.created_at
      FROM simulation_run sr
      LEFT JOIN policy_branch pb ON pb.id = sr.branch_id AND pb.tenant_id = sr.tenant_id
      LEFT JOIN app_principal author ON author.id::text = sr.created_by AND author.tenant_id = sr.tenant_id
      WHERE sr.tenant_id = ${tenantId}
        AND (sr.workspace_id = ${workspaceId} OR sr.workspace_id IS NULL)
      ORDER BY sr.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      revisionId: row.revision_id,
      branchName: row.branch_name,
      sourceEventCount: row.source_event_count,
      newlyDeniedCount: row.newly_denied_count,
      newlyAllowedCount: row.newly_allowed_count,
      unchangedCount: row.unchanged_count,
      regressionSummary: parseRegressionSummary(row.regression_summary),
      createdBy: row.created_by,
      createdByEmail: row.created_by_email ?? null,
      createdAt: row.created_at.toISOString()
    }));
  } catch (err) {
    logger.error("[listSimulationRuns] failed:", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
