import { getAgentsPageModel } from "@/lib/domains/agents/service";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { AgentInspector } from "./agent-inspector";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { QuickStartBanner } from "../quick-start-banner";
import { getTranslations } from "next-intl/server";
import { RuntimeAssurancePanel } from "./runtime-assurance-panel";

export async function AgentsPageContent({ workspaceSlug }: { workspaceSlug?: string } = {}) {
  const t = await getTranslations("agents");
  const appViewMode = await getAppViewMode();
  const {
    workspaceContext,
    agents,
    currentCount,
    denyRate,
    surfacesByAgent,
    blueprintsByAgent,
    productionHeartbeatAssurance,
    policyScopedDiscovery,
    connectorActionCoverage,
  } = await getAgentsPageModel({ workspaceSlug });
  const attentionAgents = agents.filter((agent) => agent.healthStatus !== "CURRENT");
  const currentAgents = agents.filter((agent) => agent.healthStatus === "CURRENT");
  const attentionCount = attentionAgents.length;
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });
  const controlPlaneUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev";

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspaceContext)}</p>
          <h1>{t("title")}</h1>
        </div>
      </section>

      <section className="agentHero" aria-label="Agent fleet summary">
        <div className="agentHeroMain">
          <p className="eyebrow">Fleet health</p>
          <h2>Agent coverage</h2>
          <p className="meta">
            {agents.length} agent{agents.length === 1 ? "" : "s"} · {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
          </p>
          <div className="agentSummary">
            {attentionCount > 0 ? <span className="pill pillWarn">{attentionCount} need attention</span> : <span className="pill pillAllow">All reporting current policy</span>}
            <span className="meta">{currentCount} on current policy</span>
          </div>
        </div>
        <div className="agentHeroContext">
          <span className="meta">Fleet deny rate</span>
          <strong>{denyRate}%</strong>
          <span className="meta">Based on recorded decisions</span>
        </div>
      </section>

      {agents.length === 0 ? (
        <QuickStartBanner controlPlaneUrl={controlPlaneUrl} status={onboardingStatus} surface="agents" workspaceSlug={workspaceContext.workspaceSlug} />
      ) : (
        <>
          {attentionCount > 0 ? (
            <section className="panel agentPanel" aria-labelledby="agents-attention-title">
              <div className="rowHeader">
                <div>
                  <p className="eyebrow">Review queue</p>
                  <h2 id="agents-attention-title">Needs attention <span className="headCount">{attentionCount}</span></h2>
                  <p className="meta">Review agents with policy drift, missing reports, or an unknown policy state.</p>
                </div>
              </div>
              <div className="agentGrid">
                {attentionAgents.map((agent) => <AgentInspector key={`${agent.agentId}-${agent.environment}-${agent.runtimeStack}`} agent={agent} viewMode={appViewMode} surfaces={surfacesByAgent[agent.agentId]} blueprint={blueprintsByAgent[agent.agentId]} attention />)}
              </div>
            </section>
          ) : null}

          {currentAgents.length > 0 ? (
            <section className="panel agentPanel" aria-labelledby="agents-current-title">
              <div className="rowHeader">
                <div>
                  <p className="eyebrow">Fleet inventory</p>
                  <h2 id="agents-current-title">Current agents <span className="headCount">{currentAgents.length}</span></h2>
                  <p className="meta">These agents are reporting and running the current published policy. Inspect one for its runtime identity and decision history.</p>
                </div>
              </div>
              <div className="agentGrid">
                {currentAgents.map((agent) => <AgentInspector key={`${agent.agentId}-${agent.environment}-${agent.runtimeStack}`} agent={agent} viewMode={appViewMode} surfaces={surfacesByAgent[agent.agentId]} blueprint={blueprintsByAgent[agent.agentId]} />)}
              </div>
            </section>
          ) : null}

          <RuntimeAssurancePanel assurance={productionHeartbeatAssurance} discovery={policyScopedDiscovery} coverage={connectorActionCoverage} />
        </>
      )}
    </>
  );
}
