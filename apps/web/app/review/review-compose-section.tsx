import type { PolicyCompositionPreview } from "@spctre/policy-schema";
import type { AppViewMode } from "@/lib/app-view-mode";
import { formatArtifactHash, formatProvenanceId } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { ComposeReviewButton } from "./compose-button";
import { CompositionLayerInspector } from "./composition-layer-inspector";

interface ReviewComposeSectionProps {
  composition: PolicyCompositionPreview;
  branchId: string;
  revisionId: string;
  workspaceSlug: string | undefined;
  viewMode: AppViewMode;
}

export function ReviewComposeSection({
  composition,
  branchId,
  revisionId,
  workspaceSlug,
  viewMode,
}: ReviewComposeSectionProps) {
  return (
    <section className="panel reviewPanel" id="compose">
      <div className="rowHeader">
        <div>
          <p
            className="eyebrow helpTerm"
            data-tooltip="Policy composition merges multiple branch layers (organization, workspace, environment, connector) into a single artifact hash deployed to agents."
          >
            Step 1 · Prepare
          </p>
          <h2>
            Built bundle{" "}
            <code>
              {formatArtifactHash(composition.composedArtifactHash, viewMode, hashToFingerprint)}
            </code>
          </h2>
          <p className="meta">
            {composition.layers.length} layers merged. This prepares the bundle for approvals; it
            does not publish policy.
          </p>
        </div>
        <ComposeReviewButton
          branchId={branchId}
          revisionId={revisionId}
          workspaceSlug={workspaceSlug ?? ""}
        />
      </div>

      <div className="policyStack">
        <span className="metadata">Policy stack</span>
        {(["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR"] as const).map(
          (scope, i, arr) => {
            const hasScope = composition.layers.some((l) => l.scope === scope);
            return (
              <span className="policyStackStep" key={scope}>
                <span
                  className={`${hasScope ? (scope === "ORGANIZATION" ? "pill pillBlock" : "pill pillNeutral") : "pill"}${
                    hasScope ? "" : " policyStackMissing"
                  }`}
                >
                  {scope}
                </span>
                {i < arr.length - 1 ? <span className="meta">/</span> : null}
              </span>
            );
          },
        )}
        <span className="meta">
          Org overrides workspace, workspace overrides environment, environment overrides connector.
        </span>
      </div>

      <div className="compositionLayout">
        <div className="layerList">
          {composition.layers.map((layer) => (
            <CompositionLayerInspector
              key={`${layer.scope}-${layer.revisionId}`}
              layer={layer}
              conflictNotes={composition.conflictNotes}
              viewMode={viewMode}
            />
          ))}
        </div>

        <div className="compositionSummary">
          <div>
            <span className="meta">Effective rules</span>
            <strong>{composition.effectiveRules.length}</strong>
          </div>
          <div>
            <span className="meta">Layers</span>
            <strong>{composition.layers.length}</strong>
          </div>
          <div>
            <span className="meta">Composed</span>
            <strong>{composition.composedAt.slice(0, 10)}</strong>
          </div>
        </div>
      </div>

      <div className="compositionNotes">
        {composition.conflictNotes.length ? (
          composition.conflictNotes.map((note) => (
            <p className="meta" key={note}>
              {note}
            </p>
          ))
        ) : (
          <p className="meta">0 conflicts.</p>
        )}
      </div>

      <div className="exportRules">
        {composition.effectiveRules.map((rule) => (
          <span className="ruleRef" key={rule.stableRuleId}>
            {rule.stableRuleId}
          </span>
        ))}
      </div>
    </section>
  );
}
