import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { SimulationRegressionSummary } from "@spctre/policy-schema";

export function SimulationRegressionReadiness({
  summary,
  sourceEventCount,
  inspectedEventCount,
}: {
  summary?: SimulationRegressionSummary;
  sourceEventCount: number;
  inspectedEventCount: number;
}) {
  if (!summary) {
    return (
      <section className="simulationRegressionReadiness" aria-labelledby="replay-readiness-title">
        <div className="simulationRegressionIntro">
          <p className="eyebrow">Publish evidence</p>
          <h3 id="replay-readiness-title">Regression readiness</h3>
          <p className="meta">
            No saved replay covers this revision yet. Run a retained-log simulation before Cloud
            publication.
          </p>
        </div>
        <span className="pill pillWarn">Replay required</span>
      </section>
    );
  }

  const isRetainedLog = summary.coverage === "RETAINED_LOG";
  const isClear = isRetainedLog && summary.blockingCount === 0;
  const coverageLabel = isRetainedLog ? "Retained log" : "Sampled replay";

  return (
    <section className="simulationRegressionReadiness" aria-labelledby="replay-readiness-title">
      <div className="simulationRegressionIntro">
        <p className="eyebrow">Publish evidence</p>
        <h3 id="replay-readiness-title">Regression readiness</h3>
        <p className="meta">
          {isRetainedLog
            ? `${coverageLabel} · ${sourceEventCount} source events`
            : `${coverageLabel} · ${inspectedEventCount} of ${sourceEventCount} events inspected`}{" "}
          ·{" "}
          {isClear
            ? "No blocking regressions"
            : `${summary.blockingCount} blocking regression${summary.blockingCount === 1 ? "" : "s"}`}
        </p>
      </div>
      <span
        className={isClear ? "pill pillAllow" : isRetainedLog ? "pill pillBlock" : "pill pillWarn"}
      >
        {isClear
          ? "No blocking regressions"
          : isRetainedLog
            ? "Publish blocked"
            : "Not publishable"}
      </span>

      <dl className="simulationRegressionChecks">
        <RegressionCheck
          icon={<AlertTriangle size={15} />}
          label="Newly denied expected work"
          value={summary.newlyDeniedExpectedWorkCount}
          clearLabel="No expected work newly denied"
        />
        <RegressionCheck
          icon={<ShieldAlert size={15} />}
          label="Removed escalation coverage"
          value={summary.removedEscalationCoverageCount}
          clearLabel="Escalation coverage preserved"
        />
        <RegressionCheck
          icon={<ShieldAlert size={15} />}
          label="Newly allowed high-risk actions"
          value={summary.newlyAllowedHighRiskCount}
          clearLabel="High-risk controls preserved"
        />
      </dl>
    </section>
  );
}

function RegressionCheck({
  icon,
  label,
  value,
  clearLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  clearLabel: string;
}) {
  const hasRegression = value > 0;
  return (
    <div
      className={
        hasRegression
          ? "simulationRegressionCheck simulationRegressionCheckBlocked"
          : "simulationRegressionCheck"
      }
    >
      <dt>
        {hasRegression ? icon : <CheckCircle2 size={15} />}
        <span>{label}</span>
      </dt>
      <dd>{hasRegression ? `${value} finding${value === 1 ? "" : "s"}` : clearLabel}</dd>
    </div>
  );
}
