import { formatProvenanceId, isForensicViewMode, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { buildWorkspacePath } from "@/lib/workspace/path";
import type { SimulationRunSummary } from "@/lib/domains/evidence/service";

export function SimulationHistorySection({
  simulationHistory,
  viewMode,
  workspaceSlug,
}: {
  simulationHistory: SimulationRunSummary[] | null;
  viewMode: AppViewMode;
  workspaceSlug: string;
}) {
  if (simulationHistory === null) return null;

  return (
    <section className="panel evidencePanel" id="simulation-history">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Audit · Simulation history</p>
          <h2>
            Prior runs
            <span className="headCount">{simulationHistory.length}</span>
          </h2>
          <p className="meta">Most recent first.</p>
        </div>
      </div>
      {simulationHistory.length === 0 ? (
        <div className="emptyState">
          <h3>No simulation runs yet</h3>
          <p className="meta">Run a simulation above to populate this history.</p>
        </div>
      ) : (
        <div className="simulationHistoryList">
          {simulationHistory.map((run) => (
            <SimulationHistoryRow key={run.id} run={run} viewMode={viewMode} workspaceSlug={workspaceSlug} />
          ))}
        </div>
      )}
    </section>
  );
}

function SimulationHistoryRow({ run, viewMode, workspaceSlug }: { run: SimulationRunSummary; viewMode: AppViewMode; workspaceSlug: string }) {
  return (
    <article className="row">
      <div className="rowHeader">
        <div>
          <h3>{run.branchName ?? run.branchId}</h3>
          <p className="meta">
            <code>{formatProvenanceId(run.revisionId, viewMode, 12, hashToFingerprint)}</code> / {isForensicViewMode(viewMode) ? run.createdBy : (run.createdByEmail ?? run.createdBy)} / {run.createdAt.slice(0, 10)}
          </p>
        </div>
        <div className="rowActions">
          {run.regressionSummary ? (
            <span className={run.regressionSummary.coverage === "RETAINED_LOG" && run.regressionSummary.blockingCount === 0 ? "pill pillAllow" : run.regressionSummary.coverage === "RETAINED_LOG" ? "pill pillBlock" : "pill pillWarn"}>
              {run.regressionSummary.coverage === "RETAINED_LOG" ? `${run.regressionSummary.blockingCount} blockers` : "Sampled"}
            </span>
          ) : null}
          <span className="pill">{run.sourceEventCount} events</span>
          <a className="button buttonSmall" href={buildWorkspacePath(workspaceSlug, `/simulate?sim_run=${encodeURIComponent(run.id)}`)}>
            Inspect replay
          </a>
        </div>
      </div>
      <div className="simulationSummary" aria-label="Simulation run summary">
        <div>
          <span className="meta">Newly denied</span>
          <strong>{run.newlyDeniedCount}</strong>
        </div>
        <div>
          <span className="meta">Newly allowed</span>
          <strong>{run.newlyAllowedCount}</strong>
        </div>
        <div>
          <span className="meta">Unchanged</span>
          <strong>{run.unchangedCount}</strong>
        </div>
      </div>
    </article>
  );
}
