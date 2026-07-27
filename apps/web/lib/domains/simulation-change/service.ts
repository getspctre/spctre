import { getActiveActor } from "@/lib/actors";
import type { ActiveScope } from "@/lib/workspace";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { getEvidenceSimulationRun } from "@/lib/repositories/evidence";
import type { SimulationReplayInput, SimulationRun } from "@spctre/policy-schema";

const SIMULATION_GUIDANCE_SOURCE_ID = "system:simulation-guidance-v1";

type SimulationChangeCategory = "SIMULATION_GUIDED_CHANGE";

interface SimulationChangeProposal {
  ruleRef: string;
  changeType: "REVIEW_DENY_SCOPE" | "REVIEW_ALLOW_SCOPE" | "INSPECT_MATCH_CONDITIONS" | "HOLD_POLICY";
  affectedEvents: number;
  reason: string;
}

export interface SimulationChangeRecommendation {
  recommendationId: string;
  sourceId: typeof SIMULATION_GUIDANCE_SOURCE_ID;
  category: SimulationChangeCategory;
  branchId: string;
  revisionId: string;
  runId: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  rationale: string[];
  proposals: SimulationChangeProposal[];
  sourceEventCount: number;
  newlyDeniedCount: number;
  newlyAllowedCount: number;
  unchangedCount: number;
  sampledEventIds: string[];
  generatedAt: string;
}

function confidenceForRun(run: SimulationRun): SimulationChangeRecommendation["confidence"] {
  const changedCount = run.results.filter((result) => result.delta !== "UNCHANGED").length;
  const changeRate = run.results.length > 0 ? changedCount / run.results.length : 0;
  if (changedCount >= 6 && changeRate >= 0.4) return "HIGH";
  if (changedCount >= 2 || changeRate >= 0.2) return "MEDIUM";
  return "LOW";
}

function topRuleRefs(results: SimulationReplayInput[]): Array<{ ruleRef: string; affectedEvents: number; denyEvents: number; allowEvents: number }> {
  const counts = new Map<string, { affectedEvents: number; denyEvents: number; allowEvents: number }>();
  for (const result of results) {
    if (result.delta === "UNCHANGED") continue;
    const refs = result.matchedPolicyRefs.length ? result.matchedPolicyRefs : ["unmatched-policy-path"];
    for (const ruleRef of refs) {
      const entry = counts.get(ruleRef) ?? { affectedEvents: 0, denyEvents: 0, allowEvents: 0 };
      entry.affectedEvents += 1;
      if (result.delta === "NEW_DENY") entry.denyEvents += 1;
      if (result.delta === "NEW_ALLOW") entry.allowEvents += 1;
      counts.set(ruleRef, entry);
    }
  }
  return [...counts.entries()]
    .map(([ruleRef, entry]) => ({ ruleRef, ...entry }))
    .sort((left, right) => right.affectedEvents - left.affectedEvents)
    .slice(0, 3);
}

function proposalForRule(rule: ReturnType<typeof topRuleRefs>[number]): SimulationChangeProposal {
  if (rule.denyEvents > rule.allowEvents) {
    return {
      ruleRef: rule.ruleRef,
      changeType: "REVIEW_DENY_SCOPE",
      affectedEvents: rule.affectedEvents,
      reason: `${rule.denyEvents} sampled event(s) become denied; review connector, action, and domain scope before publishing.`,
    };
  }
  if (rule.allowEvents > rule.denyEvents) {
    return {
      ruleRef: rule.ruleRef,
      changeType: "REVIEW_ALLOW_SCOPE",
      affectedEvents: rule.affectedEvents,
      reason: `${rule.allowEvents} sampled event(s) become allowed; verify the rule does not remove required approval coverage.`,
    };
  }
  return {
    ruleRef: rule.ruleRef,
    changeType: "INSPECT_MATCH_CONDITIONS",
    affectedEvents: rule.affectedEvents,
    reason: "Mixed simulation deltas point to selector or condition changes that need reviewer calibration.",
  };
}

function buildSimulationChangeRecommendation(run: SimulationRun): SimulationChangeRecommendation {
  const changedResults = run.results.filter((result) => result.delta !== "UNCHANGED");
  const topRules = topRuleRefs(run.results);
  const proposals = topRules.length
    ? topRules.map(proposalForRule)
    : [{
        ruleRef: "no-material-change",
        changeType: "HOLD_POLICY" as const,
        affectedEvents: 0,
        reason: "No sampled outcomes changed, so hold the policy steady.",
      }];
  const leadingRule = proposals[0]?.ruleRef ?? "the simulated revision";
  const generatedAt = new Date().toISOString();

  return {
    recommendationId: `simulation-change-${run.revisionId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}`,
    sourceId: SIMULATION_GUIDANCE_SOURCE_ID,
    category: "SIMULATION_GUIDED_CHANGE",
    branchId: run.branchId,
    revisionId: run.revisionId,
    runId: run.id,
    confidence: confidenceForRun(run),
    summary: changedResults.length
      ? `Review ${leadingRule} before publish; simulation changed ${changedResults.length} sampled outcome(s).`
      : "Hold policy changes; simulation did not change sampled outcomes.",
    rationale: [
      `${run.newlyDeniedCount} newly denied, ${run.newlyAllowedCount} newly allowed, and ${run.unchangedCount} unchanged sampled outcome(s).`,
      `${run.sourceEventCount} source event(s) were available for replay; ${run.results.length} were inspected for recommendation context.`,
      "This guidance records reviewer feedback only and does not create or publish a policy revision.",
    ],
    proposals,
    sourceEventCount: run.sourceEventCount,
    newlyDeniedCount: run.newlyDeniedCount,
    newlyAllowedCount: run.newlyAllowedCount,
    unchangedCount: run.unchangedCount,
    sampledEventIds: run.results.slice(0, 10).map((result) => result.eventId),
    generatedAt,
  };
}

export type GenerateSimulationChangeResult =
  | { error: string }
  | { ok: true; recommendation: SimulationChangeRecommendation };

export async function generateSimulationChangeRecommendation(input: {
  branchId: string;
  revisionId: string;
}, scope: ActiveScope | null): Promise<GenerateSimulationChangeResult> {
  const workspaceContext = scope;
  if (!workspaceContext) return { error: "Workspace context unavailable." };

  const activeActorResult = await getActiveActor({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId,
  }).catch(() => null);
  if (!activeActorResult?.actor) return { error: "Authentication required." };

  const run = await getEvidenceSimulationRun(
    input.branchId || undefined,
    input.revisionId || undefined,
    workspaceContext.workspaceId,
    workspaceContext.tenantId,
    SIMULATION_GUIDANCE_SOURCE_ID
  );
  if (!run) return { error: "No completed simulation result is available for this revision." };

  const recommendation = buildSimulationChangeRecommendation(run);
  appendOperationsLog({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    eventType: "SIMULATION_GUIDANCE",
    sourceId: run.id,
    sourceTable: "simulation_run",
    actorId: SIMULATION_GUIDANCE_SOURCE_ID,
    payload: {
      action: "RECOMMENDED",
      generatedForActorId: activeActorResult.actor.id,
      recommendation,
    },
  }).catch(() => {});

  return { ok: true, recommendation };
}

export type ApplySimulationChangeResult = { error: string } | { ok: true };

export async function applySimulationChangeDecision(input: {
  decision: string;
  rationale?: string;
  recommendationId?: string;
  branchId?: string;
  revisionId?: string;
  runId?: string;
  recommendationSummary?: string;
  editedSummary?: string;
}, scope: ActiveScope | null): Promise<ApplySimulationChangeResult> {
  const workspaceContext = scope;
  if (!workspaceContext) return { error: "Workspace context unavailable." };

  const { actor } = await getActiveActor({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId,
  }).catch(() => ({ actor: null }));
  if (!actor) return { error: "Authentication required." };

  if (input.decision !== "ACCEPT" && input.decision !== "EDIT" && input.decision !== "REJECT") {
    return { error: "Recommendation decision must be ACCEPT, EDIT, or REJECT." };
  }
  if (!input.rationale?.trim()) {
    return { error: "Reviewer rationale is required for recommendation decisions." };
  }
  if (!input.branchId?.trim() || !input.revisionId?.trim()) {
    return { error: "Branch and revision are required." };
  }

  appendOperationsLog({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    eventType: "SIMULATION_GUIDANCE",
    sourceId: input.runId || input.revisionId,
    sourceTable: "simulation_run",
    actorId: actor.id,
    payload: {
      action: input.decision,
      sourceId: SIMULATION_GUIDANCE_SOURCE_ID,
      recommendationId: input.recommendationId,
      category: "SIMULATION_GUIDED_CHANGE",
      branchId: input.branchId,
      revisionId: input.revisionId,
      runId: input.runId,
      recommendationSummary: input.recommendationSummary,
      editedSummary: input.editedSummary,
      rationale: input.rationale,
      policyWriteCreated: false,
    },
  }).catch(() => {});

  return { ok: true };
}
