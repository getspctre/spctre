import { POLICY_PACKS } from "@spctre/policy-schema";
import { listAgentSummaries, listSimulationRuns } from "@/lib/repositories/evidence";
import { listBranches } from "@/lib/repositories/policy";
import {
  getCommercialProfile,
  getCommercialUsageSummary,
  listCommercialEvents,
  requestCommercialReview,
} from "@/lib/repositories/workspace";
import { getUsagePeriod } from "@/lib/repositories/usage/metering";
import { swallow } from "@/lib/platform/swallow";

export async function getUsageBillingInputs(params: {
  workspaceId: string;
  tenantId: string;
  workspaceCountFallback: number;
  simulationLimit?: number;
  commercialEventsLimit?: number;
}) {
  const [usage, profile, events, branches, agents, simulations, usagePeriod] = await Promise.all([
    getCommercialUsageSummary(params.workspaceId, params.tenantId).catch(
      swallow("getCommercialUsageSummary", {
        workspaceCount: params.workspaceCountFallback,
        policyBundleCount: 0,
        retainedAuditEventCount: 0,
        productionEnvironmentCount: 0,
        serviceTokenCount: 0,
      }),
    ),
    getCommercialProfile(params.tenantId),
    listCommercialEvents(params.workspaceId, params.tenantId, params.commercialEventsLimit),
    listBranches(params.workspaceId, params.tenantId).catch(swallow("listBranches", [])),
    listAgentSummaries(params.workspaceId, params.tenantId).catch(
      swallow("listAgentSummaries", []),
    ),
    listSimulationRuns(params.workspaceId, params.tenantId, params.simulationLimit).catch(
      swallow("listSimulationRuns", []),
    ),
    // The authoritative retained-event measurement for the current billing
    // period. Null until the first governed event of the period creates the
    // row, and its retainedCount is null until the audit seeds it — the surface
    // distinguishes both from a measured zero.
    getUsagePeriod(params.tenantId).catch(swallow("getUsagePeriod", null)),
  ]);

  return { usage, profile, events, branches, agents, simulations, usagePeriod };
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
