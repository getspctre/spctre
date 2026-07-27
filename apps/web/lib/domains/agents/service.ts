import type { WorkspaceContext } from "@/lib/workspace/types";
import { getWorkspaceContext } from "@/lib/workspace";
import {
  listAgentEvidenceDecisions,
  listAgentSummaries,
  type AgentSummary,
} from "@/lib/repositories/evidence";
import { listContextBudgetEvents, listTrustCalibrationPolicies } from "@/lib/repositories/trust";
import { listAllSurfaceBindingsForWorkspace } from "@/lib/repositories/identity";
import { listAgentBlueprints } from "@/lib/repositories/agent-blueprints";
import { getAgentDemoFallbackData } from "@/lib/repositories/demo-fallbacks";
import {
  listProductionConnectorActionObservations,
  listPolicyScopedRuntimeObservations,
  listProductionHeartbeatObservations,
  type ProductionHeartbeatDriftStatus,
} from "@/lib/repositories/runtime-assurance";
import { getLatestPublishedBundle } from "@/lib/repositories/policy/publish";
import { getRulesForRevision } from "@/lib/repositories/policy/rules";
import { runWithTenantContext } from "@/lib/tenant-context";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import type { AgentBlueprintSummary, AgentSurfaceBinding } from "@spctre/policy-schema";

export type { AgentSummary };

export interface AgentsPageModel {
  workspaceContext: WorkspaceContext;
  agents: AgentSummary[];
  currentCount: number;
  outdatedCount: number;
  staleCount: number;
  denyRate: string;
  surfacesByAgent: Record<string, AgentSurfaceBinding[]>;
  blueprintsByAgent: Record<string, AgentBlueprintSummary>;
  runtimeCoverage: {
    total: number;
    governed: number;
    provenanceGaps: number;
    drifted: number;
    inventory: Array<{ agentId: string; runtimeTarget: string; coverage: "GOVERNED" | "PROVENANCE_GAP"; driftStatus: "CURRENT" | "DRIFTED" | "PROVENANCE_GAP" }>;
    alerts: Array<{ agentId: string; runtimeTarget: string; severity: "HIGH" | "MEDIUM"; message: string }>;
  };
  productionHeartbeatAssurance: {
    expected: { branchId: string; revisionId: string; artifactHash: string } | null;
    total: number;
    assured: number;
    drifted: number;
    provenanceGaps: number;
    stale: number;
    inventory: Array<{
      agentId: string;
      runtimeTarget: string;
      artifactHash: string;
      observedAt: string;
      status: ProductionHeartbeatDriftStatus;
    }>;
  };
  policyScopedDiscovery: Array<{
    agentId: string;
    runtimeTarget: string;
    artifactHash: string;
    connectors: string[];
    firstSeenAt: string;
    lastSeenAt: string;
    kind: "UNMANAGED_RUNTIME_CANDIDATE" | "STALE_POLICY_ARTIFACT";
  }>;
  connectorActionCoverage: Array<{
    connector: string;
    actions: string[];
    decisions: number;
    agents: number;
    lastSeenAt: string;
    status: "GOVERNED" | "AUDIT_ONLY" | "PROVENANCE_GAP";
  }>;
}

const HEARTBEAT_STALE_MS = 60 * 60 * 1000;

function runtimeKey(params: { agentId: string; environment: string; runtimeStack: string; runtimeAdapter: string | null }) {
  return [params.agentId, params.environment, params.runtimeStack, params.runtimeAdapter ?? ""].join("\u0000");
}

function firstPolicyContext(value: unknown): { branchId?: string; revisionId?: string; artifactHash?: string } | null {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return null;
  const context = value[0] as Record<string, unknown>;
  return {
    branchId: typeof context.branchId === "string" ? context.branchId : undefined,
    revisionId: typeof context.revisionId === "string" ? context.revisionId : undefined,
    artifactHash: typeof context.artifactHash === "string" ? context.artifactHash : undefined,
  };
}

export function classifyProductionHeartbeat(params: {
  observedAt: string;
  artifactHash: string;
  policyContext: unknown;
  expected: { branchId: string; revisionId: string; artifactHash: string } | null;
  now?: number;
}): ProductionHeartbeatDriftStatus {
  const observedAt = new Date(params.observedAt).getTime();
  if (!Number.isFinite(observedAt) || (params.now ?? Date.now()) - observedAt > HEARTBEAT_STALE_MS) return "STALE";
  if (!params.expected) return "PROVENANCE_GAP";
  const context = firstPolicyContext(params.policyContext);
  if (!context?.branchId || !context.revisionId || !context.artifactHash) return "PROVENANCE_GAP";
  return context.branchId === params.expected.branchId
    && context.revisionId === params.expected.revisionId
    && context.artifactHash === params.expected.artifactHash
    && params.artifactHash === params.expected.artifactHash
    ? "CURRENT"
    : "DRIFTED";
}

export async function getAgentsPageModel({
  workspaceSlug,
}: {
  workspaceSlug?: string;
} = {}): Promise<AgentsPageModel> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const { tenantId, workspaceId } = workspaceContext;

  const [dbAgents, allSurfaces, blueprints, published, heartbeats, policyScopedObservations, connectorActionObservations] = await Promise.all([
    runWithTenantContext(tenantId, () =>
      listAgentSummaries(workspaceId, tenantId).catch(() => [])
    ),
    isFeatureEnabled("crossSurfaceAgentIdentity")
      ? runWithTenantContext(tenantId, () =>
          listAllSurfaceBindingsForWorkspace({ tenantId, workspaceId }).catch(() => [])
        )
      : Promise.resolve([] as AgentSurfaceBinding[]),
    runWithTenantContext(tenantId, () => listAgentBlueprints({ tenantId, workspaceId }).catch(() => [])),
    runWithTenantContext(tenantId, () => getLatestPublishedBundle(workspaceId, tenantId).catch(() => null)),
    runWithTenantContext(tenantId, () => listProductionHeartbeatObservations({ tenantId, workspaceId }).catch(() => [])),
    runWithTenantContext(tenantId, () => listPolicyScopedRuntimeObservations({ tenantId, workspaceId }).catch(() => [])),
    runWithTenantContext(tenantId, () => listProductionConnectorActionObservations({ tenantId, workspaceId }).catch(() => [])),
  ]);

  const agents = dbAgents.length ? dbAgents : getAgentDemoFallbackData(tenantId);
  const currentCount = agents.filter((agent) => agent.healthStatus === "CURRENT").length;
  const outdatedCount = agents.filter((agent) => agent.healthStatus === "OUTDATED").length;
  const staleCount = agents.filter((agent) => agent.healthStatus === "STALE").length;
  const totalDecisions = agents.reduce((sum, agent) => sum + agent.totalDecisions, 0);
  const totalDeny = agents.reduce((sum, agent) => sum + agent.denyCount, 0);
  const denyRate = totalDecisions > 0 ? ((totalDeny / totalDecisions) * 100).toFixed(1) : "0.0";

  const surfacesByAgent: Record<string, AgentSurfaceBinding[]> = {};
  for (const binding of allSurfaces) {
    (surfacesByAgent[binding.canonicalAgentId] ??= []).push(binding);
  }
  const blueprintsByAgent = Object.fromEntries(blueprints.map((blueprint) => [blueprint.agentId, blueprint]));
  // This is an inventory of declared/reporting runtimes only. It deliberately
  // does not scan infrastructure or infer unmanaged agents.
  const inventory = agents.map((agent) => {
    const driftStatus = agent.latestPublishedHash
      ? agent.currentArtifactHash === agent.latestPublishedHash ? "CURRENT" as const : "DRIFTED" as const
      : "PROVENANCE_GAP" as const;
    return {
      agentId: agent.agentId,
      runtimeTarget: agent.runtimeAdapter ?? agent.runtimeStack,
      driftStatus,
      coverage: driftStatus === "CURRENT" ? "GOVERNED" as const : "PROVENANCE_GAP" as const,
    };
  });
  const runtimeCoverage = {
    total: inventory.length,
    governed: inventory.filter((runtime) => runtime.coverage === "GOVERNED").length,
    provenanceGaps: inventory.filter((runtime) => runtime.coverage === "PROVENANCE_GAP").length,
    drifted: inventory.filter((runtime) => runtime.driftStatus === "DRIFTED").length,
    inventory,
    alerts: inventory.flatMap<{ agentId: string; runtimeTarget: string; severity: "HIGH" | "MEDIUM"; message: string }>((runtime) => runtime.driftStatus === "DRIFTED"
      ? [{ agentId: runtime.agentId, runtimeTarget: runtime.runtimeTarget, severity: "HIGH" as const, message: "Runtime artifact differs from the published policy." }]
      : runtime.driftStatus === "PROVENANCE_GAP"
        ? [{ agentId: runtime.agentId, runtimeTarget: runtime.runtimeTarget, severity: "MEDIUM" as const, message: "Runtime has no published artifact provenance." }]
        : []),
  };

  const expected = published
    ? { branchId: published.branchId, revisionId: published.revisionId, artifactHash: published.artifactHash }
    : null;
  const publishedRules = published
    ? await runWithTenantContext(tenantId, () => getRulesForRevision(published.revisionId, tenantId).catch(() => []))
    : [];
  const heartbeatInventory = heartbeats.map((heartbeat) => ({
    agentId: heartbeat.agentId,
    runtimeTarget: heartbeat.runtimeAdapter ?? heartbeat.runtimeStack,
    artifactHash: heartbeat.artifactHash,
    observedAt: heartbeat.observedAt,
    status: classifyProductionHeartbeat({
      observedAt: heartbeat.observedAt,
      artifactHash: heartbeat.artifactHash,
      policyContext: heartbeat.policyContext,
      expected,
    }),
  }));
  const productionHeartbeatAssurance = {
    expected,
    total: heartbeatInventory.length,
    assured: heartbeatInventory.filter((heartbeat) => heartbeat.status === "CURRENT").length,
    drifted: heartbeatInventory.filter((heartbeat) => heartbeat.status === "DRIFTED").length,
    provenanceGaps: heartbeatInventory.filter((heartbeat) => heartbeat.status === "PROVENANCE_GAP").length,
    stale: heartbeatInventory.filter((heartbeat) => heartbeat.status === "STALE").length,
    inventory: heartbeatInventory,
  };
  const heartbeatKeys = new Set(heartbeats.map(runtimeKey));
  const policyScopedDiscovery: AgentsPageModel["policyScopedDiscovery"] = [];
  for (const observation of policyScopedObservations) {
    const heartbeat = heartbeatKeys.has(runtimeKey(observation));
    const isStaleArtifact = expected && observation.artifactHash !== expected.artifactHash;
    if (!heartbeat) {
      policyScopedDiscovery.push({
        agentId: observation.agentId,
        runtimeTarget: observation.runtimeAdapter ?? observation.runtimeStack,
        artifactHash: observation.artifactHash,
        connectors: observation.connectors,
        firstSeenAt: observation.firstSeenAt,
        lastSeenAt: observation.lastSeenAt,
        kind: "UNMANAGED_RUNTIME_CANDIDATE" as const,
      });
      continue;
    }
    if (isStaleArtifact) {
      policyScopedDiscovery.push({
        agentId: observation.agentId,
        runtimeTarget: observation.runtimeAdapter ?? observation.runtimeStack,
        artifactHash: observation.artifactHash,
        connectors: observation.connectors,
        firstSeenAt: observation.firstSeenAt,
        lastSeenAt: observation.lastSeenAt,
        kind: "STALE_POLICY_ARTIFACT" as const,
      });
    }
  }
  const connectorActionCoverage = connectorActionObservations.map((observation) => {
    const status = observation.decisionsWithPolicyRefs === 0
      ? "PROVENANCE_GAP" as const
      : observation.actions.every((action) => publishedRules.some((rule) => rule.connectors.includes(observation.connector) && rule.actions.includes(action)))
        ? "GOVERNED" as const
        : "AUDIT_ONLY" as const;
    return {
      connector: observation.connector,
      actions: observation.actions,
      decisions: observation.decisions,
      agents: observation.agents,
      lastSeenAt: observation.lastSeenAt,
      status,
    };
  });

  return {
    workspaceContext,
    agents,
    currentCount,
    outdatedCount,
    staleCount,
    denyRate,
    surfacesByAgent,
    blueprintsByAgent,
    runtimeCoverage,
    productionHeartbeatAssurance,
    policyScopedDiscovery,
    connectorActionCoverage,
  };
}

export async function listAgentAuditDecisions(params: {
  agentId: string;
  workspaceId: string;
  tenantId: string;
  limit: number;
}) {
  return listAgentEvidenceDecisions(params.agentId, params.workspaceId, params.tenantId, params.limit);
}
