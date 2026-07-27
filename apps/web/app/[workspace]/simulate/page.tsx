import { getSimulationPageModel } from "@/lib/domains/evidence/service";
import { formatGovernancePath } from "@/lib/workspace";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@spctre/ui";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { formatProvenanceId } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { PlanGate, UpgradePrompt } from "../../plan-gate";
import { RunSimulationForm } from "../../evidence/run-simulation-form";
import { SimulationChangeGuidance } from "../../evidence/simulation-change-guidance";
import { SimulationResultInspector } from "../../evidence/simulation-result-inspector";
import { SimulationRegressionReadiness } from "../../evidence/simulation-regression-readiness";
import { SimulationHistorySection } from "./simulation-history-section";

export const dynamic = "force-dynamic";

export default async function WorkspaceSimulationPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ sim_branch?: string; sim_revision?: string; sim_run?: string }>;
}) {
  const { workspace } = await params;
  const resolvedSearchParams = await searchParams;
  const simBranchId = resolvedSearchParams.sim_branch;
  const simRevisionId = resolvedSearchParams.sim_revision;
  const simRunId = resolvedSearchParams.sim_run;

  const {
    workspaceContext,
    activeSimulationRun,
    branches,
    simulationHistory,
    activeHeatmap,
  } = await getSimulationPageModel({
    workspaceSlug: workspace,
    simBranchId,
    simRevisionId,
    simRunId,
  });

  const appViewMode = await getAppViewMode();
  const t = await getTranslations("simulate");

  return (
    <>
      <PageHeader
        eyebrow={formatGovernancePath(workspaceContext, t("eyebrow_segment"))}
        title={t("title")}
      />

      <section className="panel evidencePanel" id="simulation">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">{t("diff_eyebrow")}</p>
            <h2>
              {t.rich("run_heading", {
                count: activeSimulationRun.sourceEventCount,
                revision: formatProvenanceId(activeSimulationRun.revisionId, appViewMode, 12, hashToFingerprint),
                code: (chunks) => <code>{chunks}</code>,
              })}
            </h2>
            <p className="meta">
              {t("sampled_meta", { count: activeSimulationRun.results.length })}
            </p>
          </div>
          <RunSimulationForm branches={branches} viewMode={appViewMode} />
        </div>

        <div className="simulationSummary" aria-label={t("summary_aria")}>
          <div>
            <span className="meta">{t("newly_denied")}</span>
            <strong>{activeSimulationRun.newlyDeniedCount}</strong>
          </div>
          <div>
            <span className="meta">{t("newly_allowed")}</span>
            <strong>{activeSimulationRun.newlyAllowedCount}</strong>
          </div>
          <div>
            <span className="meta">{t("unchanged")}</span>
            <strong>{activeSimulationRun.unchangedCount}</strong>
          </div>
        </div>

        <SimulationRegressionReadiness
          summary={activeSimulationRun.regressionSummary}
          sourceEventCount={activeSimulationRun.sourceEventCount}
          inspectedEventCount={activeSimulationRun.results.length}
        />

        {(() => {
          const connectorMap = new Map<string, { denyCount: number; warnCount: number; total: number }>();
          for (const entry of activeHeatmap) {
            const connector = entry.ruleId.split(".")[0] ?? "unknown";
            const existing = connectorMap.get(connector) ?? { denyCount: 0, warnCount: 0, total: 0 };
            existing.denyCount += entry.denyCount;
            existing.warnCount += entry.warnCount;
            existing.total += entry.total;
            connectorMap.set(connector, existing);
          }
          const connectors = [...connectorMap.entries()].sort((a, b) => b[1].denyCount - a[1].denyCount);
          if (!connectors.length) return null;
          return (
            <div className="connectorImpact">
              <p className="eyebrow">{t("deny_by_connector")}</p>
              <div className="connectorImpactList">
                {connectors.map(([connector, stats]) => {
                  const pct = stats.total > 0 ? (stats.denyCount / stats.total) * 100 : 0;
                  return (
                    <div className="connectorImpactRow" key={connector}>
                      <span className="ruleRef">{connector}</span>
                      <div className="connectorImpactTrack">
                        <div className="connectorImpactBar" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="meta">
                        {t("deny_ratio", { deny: stats.denyCount, total: stats.total })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="simulationSupport">
          <PlanGate feature="bulkProductionSimulation" fallback={<UpgradePrompt feature="bulkProductionSimulation" variant="inline" />}>
            <div className="upgradePrompt upgradePromptInline simulationCloudNotice">
              <div>
                <p className="eyebrow">{t("cloud_eyebrow")}</p>
                <h3>{t("cloud_title")}</h3>
                <p className="meta">
                  {t("cloud_body")}
                </p>
              </div>
            </div>
          </PlanGate>
          <div className="evidenceGuidanceCard">
            <div className="rowHeader">
              <div>
                <p className="eyebrow">{t("guidance_eyebrow")}</p>
                <h3>{t("guidance_title")}</h3>
                <p className="meta">
                  {t("guidance_body")}
                </p>
              </div>
            </div>
            <SimulationChangeGuidance
              branchId={activeSimulationRun.branchId}
              revisionId={activeSimulationRun.revisionId}
            />
          </div>
        </div>

        <div className="simulationList">
          {activeSimulationRun.results.map((result) => (
            <SimulationResultInspector
              key={result.eventId}
              result={result}
              branchId={activeSimulationRun.branchId}
              revisionId={activeSimulationRun.revisionId}
              workspaceSlug={workspace}
            />
          ))}
        </div>
      </section>

      <SimulationHistorySection simulationHistory={simulationHistory} viewMode={appViewMode} workspaceSlug={workspace} />
    </>
  );
}
