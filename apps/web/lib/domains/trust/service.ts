import type {
  ContextBudgetEventType,
  CrossSurfaceTrustSummary,
  TrustCalibrationPolicy,
} from "@spctre/policy-schema";
import { runWithTenantContext } from "@/lib/tenant-context";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  createTrustCalibrationPolicy,
  deleteTrustCalibrationPolicy,
  evaluateTrustGovernance,
  ingestContextBudgetEvent,
  ingestTrustScoreEvent,
  listContextBudgetEvents,
  listTrustCalibrationPolicies,
  listTrustScoreHistory,
  listTrustScoreHistoryCrossSurface,
  updateTrustCalibrationPolicy,
} from "@/lib/repositories/trust";
import { listAgentSurfaceBindings } from "@/lib/repositories/identity";

export type { ContextBudgetEventType, TrustCalibrationPolicy };

export async function listTrustPolicies(params: {
  tenantId: string;
  workspaceId: string;
  enabledOnly?: boolean;
  limit?: number;
}) {
  return runWithTenantContext(params.tenantId, () =>
    listTrustCalibrationPolicies(params.tenantId, params.workspaceId, {
      enabledOnly: params.enabledOnly,
      limit: params.limit,
    }),
  );
}

export async function createTrustPolicy(
  params: Parameters<typeof createTrustCalibrationPolicy>[0],
) {
  return createTrustCalibrationPolicy(params);
}

export async function updateTrustPolicy(params: {
  id: string;
  tenantId: string;
  patch: Parameters<typeof updateTrustCalibrationPolicy>[2];
}) {
  return updateTrustCalibrationPolicy(params.id, params.tenantId, params.patch);
}

export async function deleteTrustPolicy(params: { id: string; tenantId: string }) {
  return deleteTrustCalibrationPolicy(params.id, params.tenantId);
}

export function evaluateTrustDecision(params: {
  trustScore?: number;
  contextTokens?: number;
  budgetLimit?: number;
  agentClass?: string;
  environment?: string;
  connector?: string;
  consequenceTier?: TrustCalibrationPolicy["consequenceTier"];
  policies: TrustCalibrationPolicy[];
}) {
  return evaluateTrustGovernance(params);
}

export async function ingestContextBudget(params: Parameters<typeof ingestContextBudgetEvent>[0]) {
  return ingestContextBudgetEvent(params);
}

export async function listContextBudget(params: {
  tenantId: string;
  workspaceId: string;
  sessionId?: string;
  agentId?: string;
  eventType?: ContextBudgetEventType;
  limit?: number;
}) {
  return runWithTenantContext(params.tenantId, () =>
    listContextBudgetEvents(params.tenantId, params.workspaceId, {
      sessionId: params.sessionId,
      agentId: params.agentId,
      eventType: params.eventType,
      limit: params.limit,
    }),
  );
}

export async function ingestTrustScore(params: Parameters<typeof ingestTrustScoreEvent>[0]) {
  return ingestTrustScoreEvent(params);
}

export async function listTrustHistory(params: {
  agentId: string;
  workspaceId: string;
  tenantId: string;
  limit: number;
}) {
  return runWithTenantContext(params.tenantId, () =>
    listTrustScoreHistory(params.agentId, params.workspaceId, params.tenantId, params.limit),
  );
}

export async function recordTrustOperation(params: Parameters<typeof appendOperationsLog>[0]) {
  return appendOperationsLog(params);
}

export async function listCrossSurfaceTrustHistory(params: {
  canonicalAgentId: string;
  workspaceId: string;
  tenantId: string;
  limit: number;
}): Promise<CrossSurfaceTrustSummary> {
  const [surfaces, history] = await Promise.all([
    runWithTenantContext(params.tenantId, () =>
      listAgentSurfaceBindings({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        canonicalAgentId: params.canonicalAgentId,
      }),
    ),
    runWithTenantContext(params.tenantId, () =>
      listTrustScoreHistoryCrossSurface(
        params.canonicalAgentId,
        params.workspaceId,
        params.tenantId,
        params.limit,
      ),
    ),
  ]);
  const latestScore = history[0]?.trustScore;
  return {
    canonicalAgentId: params.canonicalAgentId,
    surfaces,
    history,
    latestScore,
    surfaceCount: surfaces.length,
  };
}
