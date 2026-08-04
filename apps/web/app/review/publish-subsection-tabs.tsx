import { Cloud } from "lucide-react";
import { TabsRow } from "@spctre/ui";
import type {
  AgtCompatiblePolicyBundle,
  AgtVerificationSummary,
  PolicyArtifactExport,
  PolicyBundleExportFormat,
} from "@spctre/policy-schema";
import { buildPolicyBundleExports } from "@spctre/policy-schema";
import type { BundleCompatibilityReport } from "@spctre/policy-schema";
import type { AppViewMode } from "@/lib/app-view-mode";
import { formatArtifactHash, formatProvenanceId } from "@/lib/app-view-mode";
import { runtimeLabels } from "@/lib/constants";
import { hashToFingerprint } from "@/lib/fingerprint";

type PublishTab = "coverage" | "verification" | "export";

const EXPORT_TARGETS: Array<{ format: PolicyBundleExportFormat; label: string }> = [
  { format: "spctre-json", label: "Spctre JSON" },
  { format: "opa-rego", label: "OPA Rego" },
  { format: "opa-bundle", label: "OPA bundle" },
  { format: "cedar", label: "Cedar" },
  { format: "mcp-proxy-config", label: "MCP proxy" },
];

interface PublishSubsectionTabsProps {
  compatibilityReport: BundleCompatibilityReport | null;
  verificationSummary: AgtVerificationSummary | null;
  activeArtifact: PolicyArtifactExport;
  activeBundle: AgtCompatiblePolicyBundle;
  viewMode: AppViewMode;
  activeTab: PublishTab;
  coverageHref: string;
  verificationHref: string;
  exportHref: string;
}

function CoverageTabContent({
  compatibilityReport,
}: {
  compatibilityReport: BundleCompatibilityReport | null;
}) {
  return (
    <>
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Workflow · Validate</p>
          <h3>Adapter coverage</h3>
          <p className="meta">Every adapter connector resolves to an active rule.</p>
        </div>
        <Cloud size={20} className="sectionIcon" />
      </div>
      {compatibilityReport && compatibilityReport.adapterCount > 0 ? (
        <>
          <div className="split">
            <div className="metric">
              <span className="meta">Adapters</span>
              <strong>{compatibilityReport.adapterCount}</strong>
            </div>
            <div className="metric">
              <span className="meta">Connectors covered</span>
              <strong>{compatibilityReport.coveredConnectors.length}</strong>
            </div>
            <div className="metric">
              <span className="meta">Connectors uncovered</span>
              <strong>{compatibilityReport.uncoveredConnectors.length}</strong>
            </div>
            <div className="metric">
              <span className="meta">Status</span>
              <strong>{compatibilityReport.compatible ? "Compatible" : "Gaps found"}</strong>
            </div>
          </div>
          {compatibilityReport.gaps.length > 0 ? (
            <div className="blastRadiusDetail">
              {compatibilityReport.gaps.map((gap) => (
                <div key={`${gap.adapterId}-${gap.stack}-${gap.environment ?? "all"}`}>
                  <p className="meta">
                    <span className={gap.severity === "ERROR" ? "pill pillBlock" : "pill pillWarn"}>
                      {gap.severity}
                    </span>{" "}
                    {gap.adapterId} ({gap.stack}
                    {gap.environment ? ` / ${gap.environment}` : ""})
                  </p>
                  <div className="exportRules">
                    {gap.uncoveredConnectors.map((c) => (
                      <span className="ruleRef" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="exportRules">
              {compatibilityReport.coveredConnectors.map((c) => (
                <span className="ruleRef" key={c}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="emptyState">
          <p className="meta">
            No adapters registered. Register one to validate this bundle on publish.
          </p>
        </div>
      )}
    </>
  );
}

function VerificationTabContent({
  verificationSummary,
  verificationLabel,
}: {
  verificationSummary: AgtVerificationSummary;
  verificationLabel: string;
}) {
  return (
    <>
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Workflow · Verify</p>
          <h3>AGT verification</h3>
          <p className="meta">
            {verificationSummary.hasResults
              ? `Last run ${verificationSummary.latestRunAt ? new Date(verificationSummary.latestRunAt).toLocaleDateString() : "unknown"}.`
              : "No verification results are attached to this revision yet."}
          </p>
        </div>
        <span
          className={
            !verificationSummary.hasResults
              ? "pill pillNeutral"
              : verificationSummary.overallOutcome === "PASS" && !verificationSummary.isStale
                ? "pill pillAllow"
                : verificationSummary.overallOutcome === "FAIL"
                  ? "pill pillBlock"
                  : "pill pillWarn"
          }
        >
          {verificationLabel}
        </span>
      </div>
      {verificationSummary.hasResults &&
      Object.keys(verificationSummary.resultsByType).length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Check type</th>
              <th>Outcome</th>
              <th>Run at</th>
            </tr>
          </thead>
          <tbody>
            {(
              Object.entries(verificationSummary.resultsByType) as [
                string,
                { outcome: string; createdAt: string },
              ][]
            ).map(([type, result]) => (
              <tr key={type}>
                <td>
                  <code>{type}</code>
                </td>
                <td>
                  <span
                    className={
                      result.outcome === "PASS"
                        ? "pill pillAllow"
                        : result.outcome === "FAIL"
                          ? "pill pillBlock"
                          : "pill pillWarn"
                    }
                  >
                    {result.outcome}
                  </span>
                </td>
                <td className="meta">{new Date(result.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="meta">
        Verification evidence is attached by your delivery workflow.{" "}
        <a href="/help-docs/ui-guides/reviewer/reviewing-a-branch">
          Review verification requirements
        </a>
        .
      </p>
    </>
  );
}

function ExportTabContent({
  activeArtifact,
  activeBundle,
  viewMode,
  readinessByFormat,
}: {
  activeArtifact: PolicyArtifactExport;
  activeBundle: AgtCompatiblePolicyBundle;
  viewMode: AppViewMode;
  readinessByFormat: Map<
    PolicyBundleExportFormat,
    ReturnType<typeof buildPolicyBundleExports>[number]
  >;
}) {
  const reviewedBundleHref = `/api/bundle/revision/${activeArtifact.revisionId}?branch=${activeBundle.branchId}`;
  return (
    <>
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Artifact tools</p>
          <h3>
            Reviewed bundle{" "}
            <code>
              {formatArtifactHash(activeArtifact.artifactHash, viewMode, hashToFingerprint)}
            </code>
          </h3>
          <p className="meta">
            Every download in this section is generated from the revision currently under review.
          </p>
        </div>
        <a className="button" href={reviewedBundleHref}>
          <Cloud size={16} />
          Download reviewed bundle
        </a>
      </div>
      <div className="exportLayout">
        <div className="artifactCard">
          <Cloud size={18} />
          <div>
            <span className="meta">Revision</span>
            <strong>
              {formatProvenanceId(activeArtifact.revisionId, viewMode, 12, hashToFingerprint)}
            </strong>
          </div>
          <div>
            <span className="meta">Source</span>
            <strong>{activeArtifact.sourceFormat}</strong>
          </div>
          <div>
            <span className="meta">Rules</span>
            <strong>{activeBundle.rules.length}</strong>
          </div>
        </div>
        <div className="targetList">
          {activeArtifact.targetStacks.map((target) => (
            <article className="target" key={`${target.stack}-${target.adapter}`}>
              <Cloud size={17} />
              <div>
                <h3>{runtimeLabels[target.stack]}</h3>
                <p className="meta">
                  {target.adapter} / {target.environment}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="bundleDocument">
        <div>
          <span className="meta">Schema fields</span>
          <strong>tenant_id / workspace_id / branch_id / revision_id</strong>
        </div>
        <div>
          <span className="meta">Generated</span>
          <strong>{activeBundle.generatedAt?.slice(0, 10)}</strong>
        </div>
        <div>
          <span className="meta">Source hash</span>
          <strong>
            {formatArtifactHash(activeBundle.sourceHash, viewMode, hashToFingerprint)}
          </strong>
        </div>
      </div>
      <div className="targetList" aria-label="Export target downloads">
        {EXPORT_TARGETS.map(({ format, label }) => {
          const readiness = readinessByFormat.get(format);
          const firstBlocker = readiness?.manifest.blockingWarnings[0];
          return (
            <a
              className="target"
              href={`${reviewedBundleHref}&format=${format}`}
              key={format}
              title={`Download ${label} export envelope`}
            >
              <Cloud size={17} />
              <div>
                <h3>{label}</h3>
                <p className="meta">
                  Artifact + manifest{" "}
                  <span className={readiness?.ok ? "pill pillAllow" : "pill pillBlock"}>
                    {readiness?.ok ? "Ready" : "Blocked"}
                  </span>
                </p>
                {firstBlocker ? <p className="meta">{firstBlocker}</p> : null}
              </div>
            </a>
          );
        })}
      </div>
      <div className="exportRules">
        {activeBundle.rules.map((rule) => (
          <span className="ruleRef" key={rule.stableRuleId}>
            {rule.stableRuleId}
          </span>
        ))}
      </div>
      <p className="meta">
        Need the deployed artifact instead?{" "}
        <a href="/api/bundle/latest">Download latest published bundle</a>. It may be a different
        revision.
      </p>
    </>
  );
}

export function PublishSubsectionTabs({
  compatibilityReport,
  verificationSummary,
  activeArtifact,
  activeBundle,
  viewMode,
  activeTab,
  coverageHref,
  verificationHref,
  exportHref,
}: PublishSubsectionTabsProps) {
  const verificationLabel = !verificationSummary?.hasResults
    ? "—"
    : verificationSummary.isStale
      ? "STALE"
      : verificationSummary.overallOutcome;
  const exportReadiness = buildPolicyBundleExports({
    bundle: activeBundle,
    formats: EXPORT_TARGETS.map((target) => target.format),
    generatedAt: activeBundle.generatedAt,
  });
  const readinessByFormat = new Map(exportReadiness.map((exported) => [exported.format, exported]));

  return (
    <section className="panel reviewPanel" id="publish">
      <nav aria-label="Readiness details">
        <TabsRow>
          <a
            className={activeTab === "coverage" ? "uiTab uiTabActive" : "uiTab"}
            href={coverageHref}
          >
            Coverage
            {compatibilityReport ? (
              <span className="headCount">
                {compatibilityReport.compatible
                  ? "ok"
                  : `${compatibilityReport.gaps.length} gap${compatibilityReport.gaps.length !== 1 ? "s" : ""}`}
              </span>
            ) : null}
          </a>
          {verificationSummary ? (
            <a
              className={activeTab === "verification" ? "uiTab uiTabActive" : "uiTab"}
              href={verificationHref}
            >
              Verification
              <span className="headCount">{verificationLabel}</span>
            </a>
          ) : null}
          <a className={activeTab === "export" ? "uiTab uiTabActive" : "uiTab"} href={exportHref}>
            Artifact tools
          </a>
        </TabsRow>
      </nav>

      {activeTab === "coverage" && <CoverageTabContent compatibilityReport={compatibilityReport} />}

      {activeTab === "verification" && verificationSummary && (
        <VerificationTabContent
          verificationSummary={verificationSummary}
          verificationLabel={verificationLabel}
        />
      )}

      {activeTab === "export" && (
        <ExportTabContent
          activeArtifact={activeArtifact}
          activeBundle={activeBundle}
          viewMode={viewMode}
          readinessByFormat={readinessByFormat}
        />
      )}
    </section>
  );
}
