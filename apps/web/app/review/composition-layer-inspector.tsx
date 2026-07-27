"use client";

import { Lock } from "lucide-react";
import type { CompositionLayer } from "@spctre/policy-schema";
import { SlideOutPanel } from "@/app/slide-out-panel";
import { formatArtifactHash, formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

interface Props {
  layer: CompositionLayer;
  conflictNotes: string[];
  viewMode: AppViewMode;
}

function LayerRuleCard({ rule, layerScope }: { rule: CompositionLayer["rules"][number]; layerScope: CompositionLayer["scope"] }) {
  return (
    <article className="packRuleDetail">
      <div className="rowHeader">
        <div>
          <h3>{rule.title}</h3>
          <p className="meta inlineMeta">
            <code>{rule.stableRuleId}</code>
            {rule.immutable ? (
              <span title="Immutable — cannot be overridden">
                <Lock size={11} className="mutedIcon" />
              </span>
            ) : null}
            {layerScope === "ORGANIZATION" && rule.immutable ? (
              <span className="miniMeta">org baseline</span>
            ) : null}
          </p>
        </div>
        <span
          className={
            rule.effect === "DENY"
              ? "pill pillBlock"
              : rule.effect === "WARN"
                ? "pill pillWarn"
                : "pill pillAllow"
          }
        >
          {rule.effect}
        </span>
      </div>
      {(rule.connectors?.length || rule.actions?.length || rule.domains?.length) ? (
        <div className="packRuleMeta">
          {rule.connectors?.length ? (
            <div>
              <span className="meta">Connectors</span>
              <strong>{rule.connectors.join(", ")}</strong>
            </div>
          ) : null}
          {rule.actions?.length ? (
            <div>
              <span className="meta">Actions</span>
              <strong>{rule.actions.join(", ")}</strong>
            </div>
          ) : null}
          {rule.domains?.length ? (
            <div>
              <span className="meta">Domains</span>
              <strong>{rule.domains.join(", ")}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function CompositionLayerInspector({ layer, conflictNotes, viewMode }: Props) {
  const layerConflicts = conflictNotes.filter(
    (note) => note.toLowerCase().includes(layer.branchId.toLowerCase())
  );

  return (
    <SlideOutPanel
      eyebrow={`${layer.scope} layer`}
      title={layer.branchId}
      description={`${layer.ruleCount} rules · ${formatProvenanceId(layer.revisionId, viewMode, 12, hashToFingerprint)} · ${formatArtifactHash(layer.artifactHash, viewMode, hashToFingerprint)}`}
      width="wide"
      trigger={({ open, triggerId }) => (
        <article className="layer">
          <button
            aria-label={`Inspect composition layer ${layer.branchId}`}
            className="rowButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <div>
              <span className="meta">{layer.scope}</span>
              <h3>{layer.branchId}</h3>
              <p className="meta">
                <code>{formatProvenanceId(layer.revisionId, viewMode, 12, hashToFingerprint)}</code> / {layer.ruleCount} rules
              </p>
            </div>
            <div className="compositionLayerBadges">
              {layer.scope === "ORGANIZATION" ? (
                <span className="pill pillBlock pillTiny">
                  <Lock size={10} /> OVERRIDES ALL
                </span>
              ) : layer.scope === "WORKSPACE" ? (
                <span className="pill pillWarn pillTiny">WORKSPACE OVERLAY</span>
              ) : null}
              <span className="pill pillTiny monoPill">
                {formatArtifactHash(layer.artifactHash, viewMode, hashToFingerprint)}
              </span>
            </div>
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Scope</span>
          <strong>{layer.scope}</strong>
        </div>
        <div>
          <span className="meta">Rules</span>
          <strong>{layer.ruleCount}</strong>
        </div>
        <div>
          <span className="meta">Conflicts</span>
          <strong>{layerConflicts.length > 0 ? layerConflicts.length : "None"}</strong>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Provenance</p>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Branch</span>
            <code className="breakCode">
              {formatProvenanceId(layer.branchId, viewMode, 16, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Revision</span>
            <code className="breakCode">
              {formatProvenanceId(layer.revisionId, viewMode, 16, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Artifact hash</span>
            <code className="breakCode">
              {formatArtifactHash(layer.artifactHash, viewMode, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Scope precedence</span>
            <strong>
              {layer.scope === "ORGANIZATION"
                ? "Highest — applies to all workspaces"
                : layer.scope === "WORKSPACE"
                  ? "Workspace-scoped — applies to this workspace"
                  : layer.scope === "ENVIRONMENT"
                    ? "Environment-scoped — applies to one environment"
                    : "Connector-scoped — applies to one connector"}
            </strong>
          </div>
        </div>
      </div>

      {layerConflicts.length > 0 ? (
        <div className="packRuleDetail">
          <p className="eyebrow">Conflict notes</p>
          <div className="packDrawerRules">
            {layerConflicts.map((note) => (
              <p className="meta" key={note}>
                {note}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {layer.rules.length > 0 ? (
        <div className="packDrawerRules">
          <p className="eyebrow">
            Effective rules from this layer
            <span className="headCount headCountInline">{layer.rules.length}</span>
          </p>
          {layer.rules.map((rule) => (
            <LayerRuleCard key={rule.stableRuleId} rule={rule} layerScope={layer.scope} />
          ))}
        </div>
      ) : (
        <div className="packDrawerRules">
          <p className="eyebrow">Effective rules</p>
          <p className="meta">Rule details not loaded for this layer.</p>
        </div>
      )}
    </SlideOutPanel>
  );
}
