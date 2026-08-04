"use client";

import { useId, useState } from "react";
import type { AgentsPageModel } from "@/lib/domains/agents/service";
import { SlideOutPanel } from "@/app/slide-out-panel";

type Assurance = AgentsPageModel["productionHeartbeatAssurance"];
type Discovery = AgentsPageModel["policyScopedDiscovery"];
type Coverage = AgentsPageModel["connectorActionCoverage"];

function relativeTime(iso: string) {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function statusPill(status: Assurance["inventory"][number]["status"]) {
  const labels = {
    CURRENT: ["pill pillAllow", "Assured"],
    DRIFTED: ["pill pillBlock", "Drifted"],
    PROVENANCE_GAP: ["pill pillWarn", "Provenance gap"],
    STALE: ["pill pillWarn", "Heartbeat stale"],
  } as const;
  const [className, label] = labels[status];
  return <span className={className}>{label}</span>;
}

function HeartbeatLedger({ assurance }: { assurance: Assurance }) {
  if (!assurance.expected) {
    return (
      <p className="assuranceEmpty">
        Publish a policy bundle before Spctre can compare production reports with the current
        policy.
      </p>
    );
  }
  if (!assurance.inventory.length) {
    return (
      <p className="assuranceEmpty">
        No production agents are reporting yet. Run <code>spctre watch --heartbeat</code> from a
        production runner to start runtime reporting.
      </p>
    );
  }
  return (
    <div className="assuranceLedger" role="region" aria-label="Production heartbeat assurance">
      <div className="assuranceLedgerHead" aria-hidden="true">
        <span>Runtime</span>
        <span>Artifact</span>
        <span>Last heartbeat</span>
        <span>Status</span>
      </div>
      {assurance.inventory.map((heartbeat) => (
        <div className="assuranceLedgerRow" key={`${heartbeat.agentId}-${heartbeat.runtimeTarget}`}>
          <div>
            <code>{heartbeat.agentId}</code>
            <span>{heartbeat.runtimeTarget}</span>
          </div>
          <code>{heartbeat.artifactHash}</code>
          <time dateTime={heartbeat.observedAt}>{relativeTime(heartbeat.observedAt)}</time>
          {statusPill(heartbeat.status)}
        </div>
      ))}
    </div>
  );
}

function DiscoveryLedger({ discovery }: { discovery: Discovery }) {
  if (!discovery.length) {
    return (
      <p className="assuranceEmpty">
        No runtime candidates need review from policy-linked production evidence in the last 30
        days.
      </p>
    );
  }
  return (
    <div className="assuranceLedger" role="region" aria-label="Policy-scoped discovery candidates">
      <div className="assuranceLedgerHead" aria-hidden="true">
        <span>Candidate</span>
        <span>Policy-relevant connectors</span>
        <span>Last seen</span>
        <span>Finding</span>
      </div>
      {discovery.map((candidate) => (
        <div
          className="assuranceLedgerRow"
          key={`${candidate.agentId}-${candidate.runtimeTarget}-${candidate.kind}`}
        >
          <div>
            <code>{candidate.agentId}</code>
            <span>{candidate.runtimeTarget}</span>
          </div>
          <span>{candidate.connectors.join(", ")}</span>
          <time dateTime={candidate.lastSeenAt}>{relativeTime(candidate.lastSeenAt)}</time>
          <span
            className={
              candidate.kind === "UNMANAGED_RUNTIME_CANDIDATE" ? "pill pillWarn" : "pill pillBlock"
            }
          >
            {candidate.kind === "UNMANAGED_RUNTIME_CANDIDATE"
              ? "Unmanaged runtime candidate"
              : "Stale policy artifact"}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoverageLedger({ coverage }: { coverage: Coverage }) {
  if (!coverage.length) {
    return (
      <p className="assuranceEmpty">No connector activity has been reported in the last 30 days.</p>
    );
  }
  return (
    <div
      className="assuranceLedger"
      role="region"
      aria-label="Production connector and action coverage"
    >
      <div className="assuranceLedgerHead" aria-hidden="true">
        <span>Connector</span>
        <span>Observed decisions</span>
        <span>Agents</span>
        <span>Coverage</span>
      </div>
      {coverage.map((entry) => {
        const label =
          entry.status === "GOVERNED"
            ? "Governed"
            : entry.status === "AUDIT_ONLY"
              ? "Audit-only"
              : "Provenance gap";
        const className =
          entry.status === "GOVERNED"
            ? "pill pillAllow"
            : entry.status === "AUDIT_ONLY"
              ? "pill pillNeutral"
              : "pill pillWarn";
        return (
          <SlideOutPanel
            description={`Last observed ${relativeTime(entry.lastSeenAt)}.`}
            eyebrow="Production connector coverage"
            key={entry.connector}
            title={entry.connector}
            width="wide"
            trigger={({ open, triggerId }) => (
              <button
                aria-label={`Inspect ${entry.connector} coverage`}
                className="assuranceLedgerRow assuranceLedgerRowButton"
                id={triggerId}
                onClick={open}
                type="button"
              >
                <div>
                  <code>{entry.connector}</code>
                  <span>Last seen {relativeTime(entry.lastSeenAt)}</span>
                </div>
                <strong>{entry.decisions}</strong>
                <strong>{entry.agents}</strong>
                <span className={className}>{label}</span>
              </button>
            )}
          >
            <div className="packDrawerSummary">
              <div>
                <span className="meta">Coverage</span>
                <span className={className}>{label}</span>
              </div>
              <div>
                <span className="meta">Observed decisions</span>
                <strong>{entry.decisions}</strong>
              </div>
              <div>
                <span className="meta">Reporting agents</span>
                <strong>{entry.agents}</strong>
              </div>
              <div>
                <span className="meta">Last observed</span>
                <strong>{relativeTime(entry.lastSeenAt)}</strong>
              </div>
            </div>
            <div className="packRuleDetail">
              <p className="eyebrow">Observed actions</p>
              <div className="packDrawerTags">
                {entry.actions.map((action) => (
                  <code className="smallCode" key={action}>
                    {action}
                  </code>
                ))}
              </div>
            </div>
            <p className="meta agentMutedBlock">
              {entry.status === "GOVERNED"
                ? "Every observed action matches the active published policy revision."
                : entry.status === "AUDIT_ONLY"
                  ? "At least one observed action has policy evidence but no matching rule in the active published revision."
                  : "Observed activity lacks policy references, so Spctre cannot establish policy provenance for this connector."}
            </p>
          </SlideOutPanel>
        );
      })}
    </div>
  );
}

export function RuntimeAssurancePanel({
  assurance,
  discovery,
  coverage,
}: {
  assurance: Assurance;
  discovery: Discovery;
  coverage: Coverage;
}) {
  const [tab, setTab] = useState<"heartbeat" | "discovery" | "coverage">("heartbeat");
  const id = useId();
  const heartbeatPanel = `${id}-heartbeat`;
  const discoveryPanel = `${id}-discovery`;
  const coveragePanel = `${id}-coverage`;
  return (
    <section className="panel agentPanel runtimeAssurancePanel" aria-labelledby={`${id}-title`}>
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Production reporting</p>
          <h2 id={`${id}-title`}>Production coverage</h2>
          <p className="meta">
            Check whether production agents are reporting, review policy-linked runtime candidates,
            and confirm that observed connector actions are covered.
          </p>
        </div>
      </div>
      <div className="assuranceTabs" role="tablist" aria-label="Production coverage views">
        <button
          aria-controls={heartbeatPanel}
          aria-selected={tab === "heartbeat"}
          className={tab === "heartbeat" ? "isActive" : ""}
          id={`${id}-heartbeat-tab`}
          onClick={() => setTab("heartbeat")}
          role="tab"
          type="button"
        >
          Runtime reporting{" "}
          <span>
            {assurance.assured}/{assurance.total} current
            {assurance.drifted ? ` · ${assurance.drifted} drifted` : ""}
            {assurance.stale ? ` · ${assurance.stale} not reporting` : ""}
          </span>
        </button>
        <button
          aria-controls={discoveryPanel}
          aria-selected={tab === "discovery"}
          className={tab === "discovery" ? "isActive" : ""}
          id={`${id}-discovery-tab`}
          onClick={() => setTab("discovery")}
          role="tab"
          type="button"
        >
          Review candidates <span>{discovery.length}</span>
        </button>
        <button
          aria-controls={coveragePanel}
          aria-selected={tab === "coverage"}
          className={tab === "coverage" ? "isActive" : ""}
          id={`${id}-coverage-tab`}
          onClick={() => setTab("coverage")}
          role="tab"
          type="button"
        >
          Connector coverage <span>{coverage.length}</span>
        </button>
      </div>
      <div
        aria-labelledby={`${id}-heartbeat-tab`}
        hidden={tab !== "heartbeat"}
        id={heartbeatPanel}
        role="tabpanel"
        tabIndex={0}
      >
        <p className="assuranceScope">
          Compares each production report with the branch, revision, and artifact in the currently
          published policy bundle.
        </p>
        <HeartbeatLedger assurance={assurance} />
      </div>
      <div
        aria-labelledby={`${id}-discovery-tab`}
        hidden={tab !== "discovery"}
        id={discoveryPanel}
        role="tabpanel"
        tabIndex={0}
      >
        <p className="assuranceScope">
          Candidates come only from policy-referencing production evidence, not an infrastructure
          scan. A runtime here isn&apos;t necessarily unmanaged — review each before acting.
        </p>
        <DiscoveryLedger discovery={discovery} />
      </div>
      <div
        aria-labelledby={`${id}-coverage-tab`}
        hidden={tab !== "coverage"}
        id={coveragePanel}
        role="tabpanel"
        tabIndex={0}
      >
        <p className="assuranceScope">
          Covered means every observed action matches the active published policy. Audit-only
          activity has policy evidence but at least one action without a matching active rule.
        </p>
        <CoverageLedger coverage={coverage} />
      </div>
    </section>
  );
}
