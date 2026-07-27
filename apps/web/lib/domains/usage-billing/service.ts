import { POLICY_PACKS } from "@spctre/policy-schema";
import { listAgentSummaries, listSimulationRuns } from "@/lib/repositories/evidence";
import { listBranches } from "@/lib/repositories/policy";
import {
  getCommercialProfile,
  getCommercialUsageSummary,
  listCommercialEvents,
  requestCommercialReview,
} from "@/lib/repositories/workspace";

export async function getUsageBillingInputs(params: {
  workspaceId: string;
  tenantId: string;
  workspaceCountFallback: number;
  simulationLimit?: number;
  commercialEventsLimit?: number;
}) {
  const [usage, profile, events, branches, agents, simulations] = await Promise.all([
    getCommercialUsageSummary(params.workspaceId, params.tenantId).catch(() => ({
      workspaceCount: params.workspaceCountFallback,
      policyBundleCount: 0,
      retainedAuditEventCount: 0,
      productionEnvironmentCount: 0,
      serviceTokenCount: 0,
    })),
    getCommercialProfile(params.tenantId),
    listCommercialEvents(params.workspaceId, params.tenantId, params.commercialEventsLimit),
    listBranches(params.workspaceId, params.tenantId).catch(() => []),
    listAgentSummaries(params.workspaceId, params.tenantId).catch(() => []),
    listSimulationRuns(params.workspaceId, params.tenantId, params.simulationLimit).catch(() => []),
  ]);

  return { usage, profile, events, branches, agents, simulations };
}

export async function getUsageBillingExportInputs(params: {
  workspaceId: string;
  tenantId: string;
}) {
  const { usage, profile, events, branches, agents, simulations } = await getUsageBillingInputs({
    workspaceId: params.workspaceId,
    tenantId: params.tenantId,
    workspaceCountFallback: 0,
    simulationLimit: 100,
    commercialEventsLimit: 25,
  });
  const importedPackIds = new Set(branches.map((branch) => branch.name));
  const importedConnectorPacks = POLICY_PACKS.filter((pack) => importedPackIds.has(pack.id));
  const simulationEventCount = simulations.reduce((sum, run) => sum + run.sourceEventCount, 0);

  return {
    usage,
    profile,
    events,
    branches,
    agents,
    simulations,
    importedConnectorPacks,
    simulationEventCount,
  };
}

export { requestCommercialReview as requestUsageBillingCommercialReview };
