import type { EvidenceRetentionRule, RetentionDecision } from "@spctre/policy-schema";
import type { AppViewMode } from "@/lib/app-view-mode";
import { formatProvenanceId } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { runtimeLabels } from "@/lib/constants";

interface RetentionPlanTabsProps {
  rules: EvidenceRetentionRule[];
  decisions: RetentionDecision[];
  appViewMode: AppViewMode;
  activeTab: "rules" | "decisions";
  rulesHref: string;
  decisionsHref: string;
}

export function RetentionPlanTabs({
  rules,
  decisions,
  appViewMode,
  activeTab,
  rulesHref,
  decisionsHref,
}: RetentionPlanTabsProps) {
  return (
    <div>
      <nav className="retentionTabs" aria-label="Retention plan views">
        <a className={activeTab === "rules" ? "uiTab uiTabActive" : "uiTab"} href={rulesHref}>
          Rules <span className="headCount">{rules.length}</span>
        </a>
        <a
          className={activeTab === "decisions" ? "uiTab uiTabActive" : "uiTab"}
          href={decisionsHref}
        >
          Decisions <span className="headCount">{decisions.length}</span>
        </a>
      </nav>

      {activeTab === "rules" ? (
        <div className="retentionRules">
          {rules.length ? (
            rules.map((rule) => (
              <article className="retentionRule" key={rule.id}>
                <div>
                  <h3>{rule.label}</h3>
                  <p className="meta">
                    Keep matching evidence for {rule.retentionDays} days.{" "}
                    {rule.exportable
                      ? "It can be included in an audit export."
                      : "It stays internal to this workspace."}
                  </p>
                </div>
                <div className="policyRefs">
                  {rule.appliesTo?.statuses?.map((status) => (
                    <span className="ruleRef" key={`${rule.id}-${status}`}>
                      status:{status}
                    </span>
                  ))}
                  {rule.appliesTo?.environments?.map((env) => (
                    <span className="ruleRef" key={`${rule.id}-${env}`}>
                      env:{env}
                    </span>
                  ))}
                  {rule.appliesTo?.runtimeStacks?.map((stack) => (
                    <span className="ruleRef" key={`${rule.id}-${stack}`}>
                      stack:{runtimeLabels[stack]}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="emptyState">
              <h3>No retention rules in this plan</h3>
              <p className="meta">
                Add a retention policy to define how this workspace preserves evidence.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="retentionDecisions">
          {decisions.length ? (
            decisions.map((decision) => (
              <article className="retentionDecision" key={decision.decisionId}>
                <div className="rowHeader">
                  <div>
                    <h3>
                      {formatProvenanceId(decision.decisionId, appViewMode, 16, hashToFingerprint)}
                    </h3>
                    <p className="meta">
                      {decision.connector} / {decision.environment} /{" "}
                      {runtimeLabels[decision.runtimeStack]}
                    </p>
                  </div>
                  <span
                    className={
                      decision.disposition === "EXPIRED"
                        ? "pill pillBlock"
                        : decision.disposition === "EXPIRING"
                          ? "pill pillWarn"
                          : "pill pillAllow"
                    }
                  >
                    {decision.disposition}
                  </span>
                </div>
                <p className="meta">
                  {decision.retentionLabel} keeps this until {decision.retainUntil?.slice(0, 10)} (
                  {decision.daysRemaining}d remaining).
                </p>
                <p className="meta">
                  {decision.exportable ? "Exportable evidence" : "Internal replay evidence"}
                </p>
              </article>
            ))
          ) : (
            <div className="emptyState">
              <h3>No evidence decisions in this plan</h3>
              <p className="meta">
                Decisions appear after runtime evidence is recorded for this workspace.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
