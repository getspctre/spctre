import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { PostureModel } from "@/lib/domains/posture/service";

function pillClass(status: "READY" | "ATTENTION" | "AT_RISK") {
  return status === "READY"
    ? "pill pillAllow"
    : status === "AT_RISK"
      ? "pill pillBlock"
      : "pill pillWarn";
}

export function PostureSection({ posture }: { posture: PostureModel }) {
  return (
    <section className="panel compliancePanel" id="posture" aria-labelledby="posture-title">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Governance posture</p>
          <h2 id="posture-title">What needs attention</h2>
          <p className="meta">
            One bounded view of control health, runtime scope, and policy efficiency.
          </p>
        </div>
        {posture.status === "READY" ? (
          <ShieldCheck size={20} className="sectionIcon" />
        ) : (
          <ShieldAlert size={20} className="sectionIcon" />
        )}
      </div>

      <div className="postureDimensions" aria-label="Posture dimensions">
        {posture.dimensions.map((dimension) => (
          <article className="postureDimension" key={dimension.id}>
            <div className="postureDimensionHeading">
              <div>
                <strong>{dimension.label}</strong>
                <small>{dimension.detail}</small>
              </div>
              <span className={pillClass(dimension.status)}>
                {dimension.status.replace("_", " ")}
              </span>
            </div>
          </article>
        ))}
      </div>

      <p className="meta postureSummary">{posture.summary}</p>
      {posture.findings.length ? (
        <div className="postureFindings" aria-label="Prioritized posture findings">
          {posture.findings.map((finding) => (
            <article className="postureFinding" key={finding.id}>
              <div className="postureFindingHeading">
                <div>
                  <p className="eyebrow">{finding.dimension.replace("_", " ")}</p>
                  <h3>{finding.title}</h3>
                  <p className="meta">{finding.detail}</p>
                </div>
                <span
                  className={
                    finding.severity === "HIGH"
                      ? "pill pillBlock"
                      : finding.severity === "MEDIUM"
                        ? "pill pillWarn"
                        : "pill pillNeutral"
                  }
                >
                  {finding.severity}
                </span>
              </div>
              <div className="postureFindingFooter">
                <span className="meta">Affected: {finding.affectedScope}</span>
                <a className="button buttonSmall" href={finding.action.href}>
                  {finding.action.label}
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="meta">No posture findings are open in the current declared scope.</p>
      )}
    </section>
  );
}
