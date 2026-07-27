"use client";

import { Bot, Clock, Info, Layers } from "lucide-react";
import type { AgentSummary } from "@/lib/domains/agents/service";
import type { AgentBlueprintSummary, AgentSurfaceBinding } from "@spctre/policy-schema";

import { SlideOutPanel } from "@/app/slide-out-panel";
import { runtimeLabels } from "@/lib/constants";
import { hashToFingerprint } from "@/lib/fingerprint";
import { formatArtifactHash, formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";

interface HealthUI {
  className: string;
  label: string;
  tooltip: string;
}

const HEALTH_UI_MAP: Record<AgentSummary["healthStatus"], HealthUI> = {
  CURRENT: {
    className: "pill pillAllow",
    label: "Current",
    tooltip: "Agent is running the latest published policy bundle"
  },
  OUTDATED: {
    className: "pill pillWarn",
    label: "Outdated (policy drift)",
    tooltip: "Agent artifact hash does not match the latest published bundle, sync required"
  },
  STALE: {
    className: "pill pillBlock",
    label: "Stale (not reporting)",
    tooltip: "Agent has not sent a heartbeat in over one hour, may be offline"
  },
  UNKNOWN: {
    className: "pill pillNeutral",
    label: "Unknown",
    tooltip: "Agent status cannot be determined"
  }
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  agent: AgentSummary;
  viewMode: AppViewMode;
  surfaces?: AgentSurfaceBinding[];
  blueprint?: AgentBlueprintSummary;
  attention?: boolean;
}

function ArtifactHashesSection({ agent, viewMode }: Props) {
  const hashMatch =
    agent.latestPublishedHash != null &&
    agent.currentArtifactHash === agent.latestPublishedHash;
  const fingerprint = hashToFingerprint(agent.currentArtifactHash);

  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Artifact hashes</p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Running artifact</span>
          <code className="breakCode">
            {formatArtifactHash(agent.currentArtifactHash, viewMode, hashToFingerprint)}
          </code>
        </div>
        <div>
          <span className="meta">Latest published</span>
          <code className="breakCode">
            {agent.latestPublishedHash
              ? formatArtifactHash(agent.latestPublishedHash, viewMode, hashToFingerprint)
              : "None"}
          </code>
        </div>
      </div>
      {!hashMatch && agent.latestPublishedHash ? (
        <>
          <p className="meta agentMutedBlock">
            Policy drift detected. This agent is running <code className="tinyCode">{fingerprint}</code> but
            the latest published bundle is{" "}
            <code className="tinyCode">
              {formatArtifactHash(agent.latestPublishedHash, viewMode, hashToFingerprint)}
            </code>.
          </p>
          <div className="agentSyncCommand">
            <p className="metadata">Sync command</p>
            <code className="tinyBreakCode">
              spctre watch --sync --agent {agent.agentId}
            </code>
          </div>
        </>
      ) : null}
      {!agent.latestPublishedHash ? (
        <p className="meta agentMutedBlock">
          No published bundle is available for comparison. Publish a policy revision on the
          Review page to establish a baseline.
        </p>
      ) : null}
    </div>
  );
}

function RuntimeIdentitySection({ agent, viewMode }: Props) {
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Runtime identity</p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Agent ID</span>
          <code className="smallCode">{formatProvenanceId(agent.agentId, viewMode, 18)}</code>
        </div>
        <div>
          <span className="meta">Environment</span>
          <strong>{agent.environment}</strong>
        </div>
        <div>
          <span className="meta">Runtime stack</span>
          <strong>{runtimeLabels[agent.runtimeStack] ?? agent.runtimeStack}</strong>
        </div>
        {agent.runtimeAdapter ? (
          <div>
            <span className="meta">Adapter</span>
            <strong>{agent.runtimeAdapter}</strong>
          </div>
        ) : null}
        <div>
          <span className="meta">Last seen</span>
          <strong>{relativeTime(agent.lastSeen)}</strong>
        </div>
      </div>
      <a className="button buttonSmall" href={`/api/agents/runtime-assurance/history?agentId=${encodeURIComponent(agent.agentId)}`}>
        Download runtime history (JSON)
      </a>
      {agent.healthStatus === "STALE" ? (
        <p className="meta agentMutedBlock">This agent has not reported for over one hour. Run <code className="tinyCode">spctre watch --heartbeat</code> from its production runner, then return here to confirm it is reporting.</p>
      ) : null}
      {agent.healthStatus === "UNKNOWN" ? (
        <p className="meta agentMutedBlock">Spctre cannot determine this agent’s policy state. Confirm its policy context and send a new runtime report.</p>
      ) : null}
    </div>
  );
}

function SurfaceBindingsSection({ surfaces, canonicalAgentId }: { surfaces: AgentSurfaceBinding[]; canonicalAgentId: string }) {
  if (surfaces.length === 0) return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">
        <Layers size={12} style={{ display: "inline", marginRight: 4 }} />
        Surface bindings
      </p>
      <p className="meta agentMutedBlock">
        This agent is active across {surfaces.length} cross-surface binding{surfaces.length !== 1 ? "s" : ""}. Decisions,
        trust signals, reviewer interventions, and identity events are correlated across all surfaces under this canonical identity.
      </p>
      <div className="packRuleMeta">
        {surfaces.map((s) => (
          <div key={s.id}>
            <span className="meta">{s.surfaceType}</span>
            <code className="smallCode">{s.surfaceAgentId}</code>
          </div>
        ))}
      </div>
      <a className="button buttonSmall" href={`/api/agents/${encodeURIComponent(canonicalAgentId)}/identity-history`}>
        Download identity history (JSON)
      </a>
    </div>
  );
}

function BlueprintSection({ blueprint, viewMode }: { blueprint?: AgentBlueprintSummary; viewMode: AppViewMode }) {
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Governance blueprint</p>
      {blueprint ? (
        <div className="packRuleMeta">
          <div><span className="meta">Blueprint</span><strong>{blueprint.name}</strong></div>
          <div><span className="meta">Lifecycle state</span><span className="pill pillNeutral">{blueprint.status.replace("_", " ")}</span></div>
          <div><span className="meta">Active revision</span><code className="smallCode">{formatProvenanceId(blueprint.activeRevisionId, viewMode, 18)}</code></div>
          {blueprint.policyRevisionId ? <div><span className="meta">Linked policy revision</span><code className="smallCode">{formatProvenanceId(blueprint.policyRevisionId, viewMode, 18)}</code></div> : null}
        </div>
      ) : <p className="meta agentMutedBlock">No declarative blueprint is linked to this agent yet. Define its purpose, permitted surfaces, budgets, and approval path before expanding its operating scope.</p>}
    </div>
  );
}

export function AgentInspector({ agent, viewMode, surfaces, blueprint, attention = false }: Props) {
  const agentDenyRate =
    agent.totalDecisions > 0
      ? ((agent.denyCount / agent.totalDecisions) * 100).toFixed(0)
      : "0";

  const health = HEALTH_UI_MAP[agent.healthStatus];

  return (
    <SlideOutPanel
      eyebrow={`${agent.environment} · ${runtimeLabels[agent.runtimeStack] ?? agent.runtimeStack}`}
      title={formatProvenanceId(agent.agentId, viewMode, 18)}
      description={`Last seen ${relativeTime(agent.lastSeen)}`}
      width="wide"
      trigger={({ open, triggerId }) => (
        <article className={attention ? "agentCard agentCardAttention" : "agentCard"}>
          <button
            aria-label={`Inspect agent ${formatProvenanceId(agent.agentId, viewMode, 18)}`}
            className="rowButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <div className="agentCardHeader">
              <div className="agentCardTitle">
                <Bot size={15} />
                <code className="agentId">{formatProvenanceId(agent.agentId, viewMode, 18)}</code>
              </div>
              <span
                className={health.className}
                title={health.tooltip}
              >
                {health.label}
                <Info size={10} className="agentHealthInfo" />
              </span>
            </div>

            <div className="agentMeta">
              <span className="pill pillEnv">{agent.environment}</span>
              <span className="pill pillStack">
                {agent.runtimeStack.replace(/_/g, " ")}
              </span>
            </div>

            <div className="agentStats agentStatsCompact">
              <div className="agentStatItem agentStatDeny">
                <span className="meta">Deny rate</span>
                <strong>{agentDenyRate}%</strong>
              </div>
              <div className="agentStatItem">
                <span className="meta">Decisions</span>
                <strong>{agent.totalDecisions}</strong>
              </div>
            </div>

            <div className="agentFooter">
              <Clock size={12} />
              <span className="meta">Last seen {relativeTime(agent.lastSeen)}</span>
              <span className="agentInspectLabel">{attention ? "Review and resolve" : "Inspect agent"}</span>
            </div>
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Health</span>
          <span className={health.className}>
            {health.label}
          </span>
        </div>
        <div>
          <span className="meta">Deny rate</span>
          <strong>{agentDenyRate}%</strong>
        </div>
        <div>
          <span className="meta">Total decisions</span>
          <strong>{agent.totalDecisions}</strong>
        </div>
      </div>

      <RuntimeIdentitySection agent={agent} viewMode={viewMode} />

      <ArtifactHashesSection agent={agent} viewMode={viewMode} />

      <BlueprintSection blueprint={blueprint} viewMode={viewMode} />

      <div className="packRuleDetail">
        <p className="eyebrow">Decision breakdown</p>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Allow</span>
            <strong>{agent.allowCount}</strong>
          </div>
          <div>
            <span className="meta">Warn</span>
            <strong>{agent.warnCount}</strong>
          </div>
          <div>
            <span className="meta">Deny</span>
            <strong>{agent.denyCount}</strong>
          </div>
          <div>
            <span className="meta">Deny rate</span>
            <strong>{agentDenyRate}%</strong>
          </div>
        </div>
      </div>

      {agent.connectors.length > 0 ? (
        <div className="packDrawerRules">
          <p className="eyebrow">Connectors</p>
          <div className="packDrawerTags">
            {agent.connectors.map((c) => (
              <span className="ruleRef" key={c}>
                {c}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {surfaces && surfaces.length > 0 ? (
        <SurfaceBindingsSection surfaces={surfaces} canonicalAgentId={agent.agentId} />
      ) : null}
    </SlideOutPanel>
  );
}
