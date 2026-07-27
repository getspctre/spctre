import { getAuthSession } from "@/lib/auth-session";
import { getAgentsPageModel } from "@/lib/domains/agents/service";
import { withApiRoute } from "@/lib/platform/api-route";

/**
 * Reviewer/API view of declared reporting inventory, production heartbeat
 * assurance, and policy-scoped discovery leads. It never performs broad asset
 * discovery or infrastructure scanning.
 */
const handleGetRuntimeAssurance = withApiRoute("/api/agents/runtime-assurance", async (request, ctx) => {
  const session = await getAuthSession().catch(() => null);
  if (!session) return ctx.error(401, "Authentication required.");
  const model = await getAgentsPageModel();
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const agentId = url.searchParams.get("agentId")?.trim();
  let inventory = status === "CURRENT" || status === "DRIFTED" || status === "PROVENANCE_GAP"
    ? model.runtimeCoverage.inventory.filter((runtime) => runtime.driftStatus === status)
    : model.runtimeCoverage.inventory;
  if (agentId) inventory = inventory.filter((runtime) => runtime.agentId === agentId);
  return ctx.json({
    coverage: {
      ...model.runtimeCoverage,
      inventory,
      total: inventory.length,
      governed: inventory.filter((runtime) => runtime.coverage === "GOVERNED").length,
      provenanceGaps: inventory.filter((runtime) => runtime.coverage === "PROVENANCE_GAP").length,
      drifted: inventory.filter((runtime) => runtime.driftStatus === "DRIFTED").length,
      alerts: model.runtimeCoverage.alerts.filter((alert) => inventory.some((runtime) => runtime.agentId === alert.agentId && runtime.runtimeTarget === alert.runtimeTarget)),
      productionHeartbeatAssurance: model.productionHeartbeatAssurance,
      policyScopedDiscovery: model.policyScopedDiscovery,
      connectorActionCoverage: model.connectorActionCoverage,
    },
  });
});

export { handleGetRuntimeAssurance as GET };
