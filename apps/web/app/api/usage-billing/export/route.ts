import { getAuthSession } from "@/lib/auth-session";
import { getUsageBillingExportInputs } from "@/lib/domains/usage-billing/service";
import { getWorkspaceContext } from "@/lib/workspace";
import { extractTraceId, makeMeta, newTraceId, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiUsageBillingExport(request?: Request) {
  const traceId = request ? extractTraceId(request) : newTraceId();
  try {
    const session = await getAuthSession().catch(swallow("getAuthSession", null));
    if (!session) {
      return withTraceId(
        Response.json(
          { error: "Authentication required.", meta: makeMeta(traceId) },
          { status: 401 },
        ),
        traceId,
      );
    }
    const workspaceContext = await getWorkspaceContext();
    if (!workspaceContext.workspaceId || !workspaceContext.tenantId) {
      return withTraceId(
        Response.json(
          { error: "Workspace context unavailable.", meta: makeMeta(traceId) },
          { status: 400 },
        ),
        traceId,
      );
    }
    const { profile, usage, events, agents, importedConnectorPacks, simulationEventCount } =
      await getUsageBillingExportInputs({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
      });

    return withTraceId(
      Response.json({
        generatedAt: new Date().toISOString(),
        tenant: { id: workspaceContext.tenantId, slug: workspaceContext.tenantSlug },
        workspace: { id: workspaceContext.workspaceId, slug: workspaceContext.workspaceSlug },
        profile,
        hostedUsageDimensions: {
          governedAgents: agents.length,
          workspaces: usage.workspaceCount,
          policyBundles: usage.policyBundleCount,
          retainedAuditEvents: usage.retainedAuditEventCount,
          importedConnectorPacks: importedConnectorPacks.length,
          productionEnvironments: usage.productionEnvironmentCount,
          simulationEvents: simulationEventCount,
        },
        operationalSignals: {
          currentAgents: agents.filter((agent) => agent.healthStatus === "CURRENT").length,
          staleAgents: agents.filter((agent) => agent.healthStatus === "STALE").length,
          activeConnectors: [...new Set(agents.flatMap((agent) => agent.connectors))],
          serviceTokens: usage.serviceTokenCount,
        },
        importedConnectorPacks: importedConnectorPacks.map((pack) => ({
          id: pack.id,
          name: pack.name,
          connector: pack.connector,
          version: pack.metadata.version,
        })),
        recentCommercialEvents: events,
        meta: makeMeta(traceId),
      }),
      traceId,
    );
  } catch (error) {
    console.error("[usage-billing/export] export failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }
}

export { handleGetApiUsageBillingExport as GET };
