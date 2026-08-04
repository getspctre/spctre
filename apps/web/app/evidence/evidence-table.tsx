"use client";

import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import type { RuntimeDecisionEvidenceRecord } from "@spctre/policy-schema";
import { runtimeLabels } from "@/lib/constants";
import { Drawer, StatusPill, statusToneFromDecision } from "@spctre/ui";
import { formatArtifactHash, formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { redactAndBoundParameters } from "@spctre/api-contracts";
import { buildWorkspacePath } from "@/lib/workspace/path";

type EnrichedPolicyContext = RuntimeDecisionEvidenceRecord["policyContext"][number] & {
  branchName?: string;
  revisionAuthorId?: string;
  revisionCreatedAt?: string;
  approvalCount?: number;
  approverIds?: string[];
  publishedAt?: string;
  publishedBy?: string;
};

interface ControlMappingEntry {
  stableRuleId: string;
  framework: string;
  controlId: string;
  rationale?: string;
}

interface Props {
  evidence: RuntimeDecisionEvidenceRecord[];
  viewMode: AppViewMode;
  highlightId?: string;
  workspaceSlug?: string;
  controlMappingIndex?: ControlMappingEntry[];
}

export function EvidenceTable({
  evidence,
  viewMode,
  highlightId,
  workspaceSlug,
  controlMappingIndex = [],
}: Props) {
  const [selected, setSelected] = useState<RuntimeDecisionEvidenceRecord | null>(null);
  const highlightRowRef = useRef<HTMLTableRowElement>(null);

  // Auto-open the inspector and scroll to a highlighted row on first render.
  useEffect(() => {
    if (!highlightId) return;
    const record = evidence.find((e) => e.decisionId === highlightId);
    if (record) {
      setSelected(record);
      // Brief delay lets the table paint before scrolling.
      setTimeout(() => {
        highlightRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [highlightId]);

  return (
    <>
      <div className="auditTableWrapper">
        <table className="auditTable">
          <thead>
            <tr>
              <th>Action</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Runtime</th>
              <th>Latency</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((audit, index) => {
              const isHeartbeat = audit.connector === "system" && audit.action === "heartbeat";
              const isHighlighted = audit.decisionId === highlightId;
              return (
                <tr
                  key={`${audit.decisionId}-${audit.createdAt}-${index}`}
                  ref={isHighlighted ? highlightRowRef : undefined}
                  className={`auditRow${isHighlighted ? " auditRowHighlight" : ""}`}
                  onClick={() => setSelected(audit)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelected(audit);
                    } else if (e.key === " ") {
                      e.preventDefault();
                      setSelected(audit);
                    }
                  }}
                  aria-label={`Inspect decision ${audit.decisionId}`}
                >
                  <td>
                    <strong>
                      {audit.connector}.{audit.action}
                    </strong>
                    {isHeartbeat ? null : (
                      <code className="auditHash">
                        {formatArtifactHash(audit.artifactHash, viewMode, hashToFingerprint)}
                      </code>
                    )}
                  </td>
                  <td>
                    <StatusPill tone={statusToneFromDecision(audit.status)}>
                      {audit.status}
                    </StatusPill>
                  </td>
                  <td>
                    <code>{audit.agentId}</code>
                  </td>
                  <td>
                    {runtimeLabels[audit.runtimeTarget.stack] ?? audit.runtimeTarget.stack}
                    {audit.rawEvidence._source === "gateway" ? (
                      <span className="pill pillNeutral pillTiny auditGatewayPill">Gateway</span>
                    ) : null}
                    {audit.rawEvidence._source === "entire" ? (
                      <span className="pill pillNeutral pillTiny auditGatewayPill">Entire</span>
                    ) : null}
                  </td>
                  <td>{audit.latencyMs}ms</td>
                  <td>{audit.createdAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected ? (
        <Drawer
          open
          onClose={() => setSelected(null)}
          width="wide"
          eyebrow={
            selected.connector === "system" && selected.action === "heartbeat"
              ? "Runtime heartbeat"
              : `${selected.connector}.${selected.action}`
          }
          title={selected.decisionId}
          description={selected.reason}
        >
          <EvidencePanelBody
            audit={selected}
            viewMode={viewMode}
            workspaceSlug={workspaceSlug}
            controlMappingIndex={controlMappingIndex}
          />
        </Drawer>
      ) : null}
    </>
  );
}

function PreFlightIntentSection({ audit }: { audit: RuntimeDecisionEvidenceRecord }) {
  if (!audit.toolIntent && !audit.planSummary && !audit.toolParameters) return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Pre-Flight Intent</p>
      <div className="packRuleMeta" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {audit.toolIntent ? (
          <div>
            <span className="meta">Tool Intent</span>
            <strong>{audit.toolIntent}</strong>
          </div>
        ) : null}
        {audit.planSummary ? (
          <div>
            <span className="meta">Plan Summary</span>
            <p className="meta evidenceSourceText" style={{ marginTop: 4 }}>
              {audit.planSummary}
            </p>
          </div>
        ) : null}
        {audit.toolParameters ? (
          <div>
            <span className="meta">Tool Parameters</span>
            <pre
              className="smallCode"
              style={{ marginTop: 4, whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 200 }}
            >
              {JSON.stringify(redactAndBoundParameters(audit.toolParameters), null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GatewayMetadataSection({ audit }: { audit: RuntimeDecisionEvidenceRecord }) {
  if (audit.rawEvidence._source !== "gateway") return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">
        Gateway metadata
        {audit.rawEvidence._provenance_gap ? (
          <span className="pill pillWarn pillTiny headCountInline">Provenance gap</span>
        ) : null}
      </p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Provider</span>
          <strong>{String(audit.rawEvidence._gateway_provider ?? "—")}</strong>
        </div>
        {audit.rawEvidence._model ? (
          <div>
            <span className="meta">Model</span>
            <strong>{String(audit.rawEvidence._model)}</strong>
          </div>
        ) : null}
        {audit.rawEvidence._prompt_tokens ? (
          <div>
            <span className="meta">Tokens (prompt / completion)</span>
            <strong>
              {String(audit.rawEvidence._prompt_tokens)} /{" "}
              {String(audit.rawEvidence._completion_tokens ?? 0)}
            </strong>
          </div>
        ) : null}
        {audit.rawEvidence._cost_usd != null ? (
          <div>
            <span className="meta">Cost</span>
            <strong>${Number(audit.rawEvidence._cost_usd).toFixed(4)}</strong>
          </div>
        ) : null}
        {Array.isArray(audit.rawEvidence._tool_declarations) &&
        audit.rawEvidence._tool_declarations.length > 0 ? (
          <div>
            <span className="meta">Tool declarations</span>
            <div className="packDrawerTags evidenceSourceText">
              {(audit.rawEvidence._tool_declarations as string[]).map((t) => (
                <span className="ruleRef" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BlueprintProvenanceSection({
  audit,
  viewMode,
}: {
  audit: RuntimeDecisionEvidenceRecord;
  viewMode: AppViewMode;
}) {
  const blueprint = audit.blueprintContext;
  if (!blueprint) return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Blueprint provenance</p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Blueprint</span>
          <strong>{blueprint.name}</strong>
        </div>
        <div>
          <span className="meta">Revision</span>
          <code className="smallCode">
            {formatProvenanceId(blueprint.revisionId, viewMode, 18)}
          </code>
        </div>
        <div>
          <span className="meta">Definition hash</span>
          <code className="smallCode">
            {formatArtifactHash(blueprint.definitionHash, viewMode, hashToFingerprint)}
          </code>
        </div>
      </div>
    </div>
  );
}

function EntireSessionSection({ audit }: { audit: RuntimeDecisionEvidenceRecord }) {
  if (audit.rawEvidence._source !== "entire") return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">
        Entire CLI session
        {Array.isArray(audit.rawEvidence._scope_violations) &&
        (audit.rawEvidence._scope_violations as string[]).length > 0 ? (
          <span className="pill pillDeny pillTiny headCountInline">Scope violation</span>
        ) : null}
      </p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Session ID</span>
          <code className="smallCode">
            {String(audit.rawEvidence._session_id ?? audit.rawEvidence._checkpoint_id ?? "—")}
          </code>
        </div>
        <div>
          <span className="meta">Agent</span>
          <strong>{String(audit.rawEvidence._agent ?? "—")}</strong>
        </div>
        {audit.rawEvidence._model ? (
          <div>
            <span className="meta">Model</span>
            <strong>{String(audit.rawEvidence._model)}</strong>
          </div>
        ) : null}
        {audit.rawEvidence._branch ? (
          <div>
            <span className="meta">Branch</span>
            <code className="smallCode">{String(audit.rawEvidence._branch)}</code>
          </div>
        ) : null}
        {audit.rawEvidence._agent_percentage != null ? (
          <div>
            <span className="meta">AI authorship</span>
            <strong>{String(audit.rawEvidence._agent_percentage)}%</strong>
          </div>
        ) : null}
        {audit.rawEvidence._total_tokens != null ? (
          <div>
            <span className="meta">Tokens (input / output)</span>
            <strong>
              {String(audit.rawEvidence._input_tokens ?? 0)} /{" "}
              {String(audit.rawEvidence._output_tokens ?? 0)}
            </strong>
          </div>
        ) : null}
        {Array.isArray(audit.rawEvidence._tool_calls) &&
        (audit.rawEvidence._tool_calls as string[]).length > 0 ? (
          <div>
            <span className="meta">Tool calls</span>
            <div className="packDrawerTags evidenceSourceText">
              {(audit.rawEvidence._tool_calls as string[]).map((t) => (
                <span className="ruleRef" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {Array.isArray(audit.rawEvidence._scope_violations) &&
        (audit.rawEvidence._scope_violations as string[]).length > 0 ? (
          <div>
            <span className="meta">Scope violations</span>
            <div className="packDrawerTags evidenceSourceText">
              {(audit.rawEvidence._scope_violations as string[]).map((v) => (
                <span className="ruleRef" key={v}>
                  {v}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextChainNode({
  ctx,
  viewMode,
  workspaceSlug,
}: {
  ctx: RuntimeDecisionEvidenceRecord["policyContext"][number];
  viewMode: AppViewMode;
  workspaceSlug?: string;
}) {
  const enriched = ctx as EnrichedPolicyContext;
  const reviewHref = workspaceSlug
    ? buildWorkspacePath(workspaceSlug, `/review?branch=${encodeURIComponent(ctx.branchId)}`)
    : `/review?branch=${encodeURIComponent(ctx.branchId)}`;
  return (
    <div className="contextNode">
      <Link2 size={15} />
      <div>
        <span className="meta">{ctx.scope}</span>
        <p>
          <a href={reviewHref} title="Review governing policy branch">
            <code>
              {enriched.branchName ??
                formatProvenanceId(ctx.branchId, viewMode, 16, hashToFingerprint)}
            </code>
          </a>
          {" / "}
          <code>{formatProvenanceId(ctx.revisionId, viewMode, 16, hashToFingerprint)}</code>
        </p>
        {enriched.revisionAuthorId || enriched.approvalCount || enriched.publishedAt ? (
          <div className="contextMetaGrid">
            {enriched.revisionAuthorId ? (
              <span className="meta">
                Author <code>{formatProvenanceId(enriched.revisionAuthorId, viewMode, 18)}</code>
              </span>
            ) : null}
            {enriched.approvalCount != null ? (
              <span className="meta">
                Approved by{" "}
                {enriched.approverIds?.length
                  ? enriched.approverIds
                      .slice(0, 2)
                      .map((id) => formatProvenanceId(id, viewMode, 14))
                      .join(", ")
                  : `${enriched.approvalCount} reviewer${enriched.approvalCount === 1 ? "" : "s"}`}
              </span>
            ) : null}
            {enriched.publishedAt ? (
              <span className="meta">
                Published {enriched.publishedAt.slice(0, 16).replace("T", " ")}
                {enriched.publishedBy
                  ? ` by ${formatProvenanceId(enriched.publishedBy, viewMode, 14)}`
                  : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        {ctx.packVersion ? (
          <p className="meta">
            {ctx.packId ?? "pack"}@{ctx.packVersion}
            {ctx.packOwner ? ` / owner: ${ctx.packOwner}` : ""}
          </p>
        ) : null}
        <p className="meta">{formatArtifactHash(ctx.artifactHash, viewMode, hashToFingerprint)}</p>
      </div>
    </div>
  );
}

function PolicyRefWithControls({
  policyRef,
  controlMappingIndex,
  workspaceSlug,
}: {
  policyRef: string;
  controlMappingIndex: ControlMappingEntry[];
  workspaceSlug?: string;
}) {
  const rulesHref = workspaceSlug
    ? buildWorkspacePath(workspaceSlug, `/rules?q=${encodeURIComponent(policyRef)}`)
    : `/rules?q=${encodeURIComponent(policyRef)}`;
  const complianceHref = workspaceSlug
    ? buildWorkspacePath(workspaceSlug, "/compliance#control-mappings")
    : "/compliance#control-mappings";
  const controls = controlMappingIndex.filter((mapping) => mapping.stableRuleId === policyRef);

  return (
    <span className="ruleRefGroup">
      <a className="ruleRef" href={rulesHref} title={`View rule ${policyRef}`}>
        {policyRef}
      </a>
      {controls.map((mapping) => (
        <a
          className="ruleRef controlRef"
          href={complianceHref}
          key={`${policyRef}-${mapping.framework}-${mapping.controlId}`}
          title={mapping.rationale ?? `Satisfies ${mapping.framework} ${mapping.controlId}`}
        >
          {mapping.framework} · {mapping.controlId}
        </a>
      ))}
    </span>
  );
}

function EvidencePanelBody({
  audit,
  viewMode,
  workspaceSlug,
  controlMappingIndex = [],
}: {
  audit: RuntimeDecisionEvidenceRecord;
  viewMode: AppViewMode;
  workspaceSlug?: string;
  controlMappingIndex?: ControlMappingEntry[];
}) {
  const isHeartbeat = audit.connector === "system" && audit.action === "heartbeat";

  return (
    <>
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Status</span>
          <StatusPill tone={statusToneFromDecision(audit.status)}>{audit.status}</StatusPill>
        </div>
        {isHeartbeat ? (
          <div>
            <span className="meta">Event type</span>
            <strong>Heartbeat</strong>
          </div>
        ) : null}
        <div>
          <span className="meta">Latency</span>
          <strong>{audit.latencyMs}ms</strong>
        </div>
        <div>
          <span className="meta">Runtime</span>
          <strong>{runtimeLabels[audit.runtimeTarget.stack] ?? audit.runtimeTarget.stack}</strong>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Decision trace</p>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Decision ID</span>
            <code className="breakCode">
              {formatProvenanceId(audit.decisionId, viewMode, 16, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Agent</span>
            <code className="smallCode">{formatProvenanceId(audit.agentId, viewMode, 18)}</code>
          </div>
          <div>
            <span className="meta">Artifact hash</span>
            <code className="breakCode">
              {formatArtifactHash(audit.artifactHash, viewMode, hashToFingerprint)}
            </code>
          </div>
          <div>
            <span className="meta">Environment</span>
            <strong>{audit.environment || "—"}</strong>
          </div>
          {audit.runtimeTarget.adapter ? (
            <div>
              <span className="meta">Adapter</span>
              <strong>{audit.runtimeTarget.adapter}</strong>
            </div>
          ) : null}
          <div>
            <span className="meta">Recorded</span>
            <strong>{audit.createdAt.slice(0, 16).replace("T", " ")}</strong>
          </div>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Reason</p>
        <p>{audit.reason}</p>
        <div>
          <span className="meta">Evidence source</span>
          <p className="meta evidenceSourceText">
            {String(audit.rawEvidence._source ?? audit.rawEvidence.source ?? "unknown")}
          </p>
        </div>
      </div>

      <PreFlightIntentSection audit={audit} />

      <GatewayMetadataSection audit={audit} />

      <BlueprintProvenanceSection audit={audit} viewMode={viewMode} />

      <EntireSessionSection audit={audit} />

      <div className="packDrawerRules">
        <p className="eyebrow">
          Policy refs
          <span className="headCount headCountInline">{audit.policyRefs.length}</span>
        </p>
        {audit.policyRefs.length ? (
          <div className="packDrawerTags">
            {audit.policyRefs.map((ref) => (
              <PolicyRefWithControls
                key={ref}
                policyRef={ref}
                controlMappingIndex={controlMappingIndex}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        ) : (
          <p className="meta">No policy refs recorded.</p>
        )}
      </div>

      <div className="packDrawerRules">
        <p className="eyebrow">
          Context chain
          <span className="headCount headCountInline">{audit.policyContext.length}</span>
        </p>
        {audit.policyContext.length ? (
          <div className="contextChain">
            {audit.policyContext.map((ctx) => (
              <ContextChainNode
                key={`${ctx.scope}-${ctx.revisionId}`}
                ctx={ctx}
                viewMode={viewMode}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        ) : (
          <p className="meta">No context chain available.</p>
        )}
      </div>
    </>
  );
}
