import { BarChart2, ShieldAlert, TrendingDown } from "lucide-react";
import type { ContextBudgetEvent, TrustCalibrationPolicy } from "@spctre/policy-schema";
import { buildWorkspacePath } from "@/lib/workspace/path";

function consequencePillClass(tier?: TrustCalibrationPolicy["consequenceTier"]) {
  if (tier === "CRITICAL") return "pill pillBlock";
  if (tier === "HIGH") return "pill pillWarn";
  if (tier === "MEDIUM") return "pill pillNeutral";
  return "pill pillAllow";
}

function TrustPolicyRow({ policy }: { policy: TrustCalibrationPolicy }) {
  return (
    <tr className="auditRow">
      <td>
        <strong>{policy.name}</strong>
        {policy.description ? <span className="meta"> — {policy.description}</span> : null}
      </td>
      <td>
        <div className="packDrawerTags">
          {policy.agentClass ? <span className="ruleRef">{policy.agentClass}</span> : null}
          {policy.environment ? <span className="ruleRef">{policy.environment}</span> : null}
          {policy.connector ? <span className="ruleRef">{policy.connector}</span> : null}
          {policy.consequenceTier ? (
            <span className={consequencePillClass(policy.consequenceTier)}>
              {policy.consequenceTier}
            </span>
          ) : null}
          {!policy.agentClass && !policy.environment && !policy.connector && !policy.consequenceTier ? (
            <span className="pill pillNeutral">all</span>
          ) : null}
        </div>
      </td>
      <td>{policy.warnThreshold !== undefined ? policy.warnThreshold.toFixed(2) : "—"}</td>
      <td>{policy.escalateThreshold !== undefined ? policy.escalateThreshold.toFixed(2) : "—"}</td>
      <td>{policy.contextWarnThreshold !== undefined ? policy.contextWarnThreshold.toLocaleString() : "—"}</td>
      <td>{policy.contextEscalateThreshold !== undefined ? policy.contextEscalateThreshold.toLocaleString() : "—"}</td>
      <td>
        {policy.decayEnabled ? (
          <span className="pill pillWarn">
            {policy.decayRate?.toFixed(3) ?? "?"} / {policy.decayPeriodHours ?? "?"}h
          </span>
        ) : (
          <span className="pill pillNeutral">off</span>
        )}
      </td>
      <td>
        <span className={policy.enabled ? "pill pillAllow" : "pill pillNeutral"}>
          {policy.enabled ? "enabled" : "disabled"}
        </span>
      </td>
    </tr>
  );
}

function BudgetEventRow({ event }: { event: ContextBudgetEvent }) {
  return (
    <tr className="auditRow">
      <td><code className="auditHash">{event.agentId.slice(0, 20)}</code></td>
      <td><code className="auditHash">{event.sessionId.slice(0, 16)}</code></td>
      <td>
        <span className={
          event.eventType === "BUDGET_BREACH" ? "pill pillBlock" :
          event.eventType === "SUMMARIZATION_EVENT" ? "pill pillWarn" :
          "pill pillNeutral"
        }>
          {event.eventType.replace(/_/g, " ")}
        </span>
      </td>
      <td>{event.tokenCount.toLocaleString()}</td>
      <td>
        {event.budgetUtilization !== undefined
          ? `${(event.budgetUtilization * 100).toFixed(1)}%`
          : "—"}
      </td>
      <td>
        {event.governanceAction ? (
          <span className={
            event.governanceAction === "ESCALATE" ? "pill pillBlock" :
            event.governanceAction === "WARN" ? "pill pillWarn" :
            event.governanceAction === "REVIEW" ? "pill pillNeutral" :
            "pill pillAllow"
          }>
            {event.governanceAction}
          </span>
        ) : "—"}
      </td>
    </tr>
  );
}

export function TrustGovernanceSection({
  policies,
  recentBudgetEvents,
  workspaceSlug,
}: {
  policies: TrustCalibrationPolicy[];
  recentBudgetEvents: ContextBudgetEvent[];
  workspaceSlug?: string;
}) {
  const enabledCount = policies.filter((p) => p.enabled).length;
  const breachCount = recentBudgetEvents.filter((e) => e.eventType === "BUDGET_BREACH").length;
  const summarizationCount = recentBudgetEvents.filter((e) => e.eventType === "SUMMARIZATION_EVENT").length;
  const evaluateHref = workspaceSlug
    ? buildWorkspacePath(workspaceSlug, "/operations?eventType=TRUST_POLICY_BREACH")
    : "/operations?eventType=TRUST_POLICY_BREACH";
  const contextBudgetHref = workspaceSlug
    ? buildWorkspacePath(workspaceSlug, "/operations?eventType=CONTEXT_BUDGET_BREACH")
    : "/operations?eventType=CONTEXT_BUDGET_BREACH";

  return (
    <section className="panel agentPanel" id="trust-calibration">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Policy config · Trust calibration</p>
          <h2>Trust calibration</h2>
          <p className="meta">
            Trust score and context budget thresholds that feed the Decision Gateway.
          </p>
        </div>
        <div className="sectionIconGroup">
          <a href={evaluateHref} title="Trust breach audit" className="iconLink">
            <ShieldAlert size={18} />
          </a>
          <a href={contextBudgetHref} title="Context budget audit" className="iconLink">
            <BarChart2 size={18} />
          </a>
        </div>
      </div>

      <div className="split">
        <div className="metric">
          <span className="meta">Active policies</span>
          <strong>{enabledCount}</strong>
          <span className="meta">of {policies.length} total</span>
        </div>
        <div className="metric">
          <span className="meta">Budget breaches (24h)</span>
          <strong>{breachCount}</strong>
          <span className={breachCount > 0 ? "pill pillBlock" : "pill pillAllow"}>
            {breachCount > 0 ? "breached" : "clean"}
          </span>
        </div>
        <div className="metric">
          <span className="meta">Summarization events (24h)</span>
          <strong>{summarizationCount}</strong>
          <span className="meta">context pressure signals</span>
        </div>
      </div>

      {policies.length === 0 ? (
        <div className="emptyState">
          <TrendingDown size={20} className="sectionIcon" />
          <h3>No calibration policies</h3>
          <p className="meta">
            Add one to set warn/escalate thresholds.
          </p>
        </div>
      ) : (
        <div className="auditTableWrapper">
          <table className="auditTable">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Scope</th>
                <th>Warn ≤</th>
                <th>Escalate ≤</th>
                <th>Ctx warn ≤</th>
                <th>Ctx escalate ≤</th>
                <th>Decay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <TrustPolicyRow key={policy.id} policy={policy} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentBudgetEvents.length > 0 && (
        <div className="agentPilotBlock">
          <p className="eyebrow">Recent context budget events</p>
          <div className="auditTableWrapper">
            <table className="auditTable">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Session</th>
                  <th>Event</th>
                  <th>Tokens</th>
                  <th>Utilization</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentBudgetEvents.slice(0, 8).map((event) => (
                  <BudgetEventRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
