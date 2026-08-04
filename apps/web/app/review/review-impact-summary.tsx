import {
  AlertTriangle,
  BadgeCheck,
  ClipboardCheck,
  FlaskConical,
  Route,
  ShieldCheck,
} from "lucide-react";
import type {
  PolicyApproval,
  PolicyApprovalRule,
  PolicyRevisionDiff,
  PublishReadiness,
  SimulationRegressionSummary,
} from "@spctre/policy-schema";
import type { BlastRadius } from "@/lib/domains/review/service";
import type { AppViewMode } from "@/lib/app-view-mode";
import { formatArtifactHash, formatProvenanceId } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

interface ReviewImpactSummaryProps {
  diff: PolicyRevisionDiff;
  blastRadius: BlastRadius | null;
  approvalRules: PolicyApprovalRule[];
  approvals: PolicyApproval[];
  readiness: PublishReadiness;
  simulationRegression: SimulationRegressionSummary | null;
  artifactHash: string | null;
  viewMode: AppViewMode;
  workspaceSlug: string;
  branchId: string | null;
  revisionId: string | null;
}

function changedControlMappings(diff: PolicyRevisionDiff) {
  const seen = new Set<string>();
  return diff.rules
    .filter((rule) => rule.status !== "UNCHANGED")
    .flatMap((rule) => (rule.after ?? rule.before)?.controlMappings ?? [])
    .filter((mapping) => {
      const key = `${mapping.framework}:${mapping.controlId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function approvalProgress(approvalRules: PolicyApprovalRule[], approvals: PolicyApproval[]) {
  const complete = approvalRules.filter((rule) =>
    approvals.some((approval) => approval.role === rule.role && approval.status === "APPROVED"),
  );
  const pending = approvalRules.filter((rule) => !complete.includes(rule));
  return { complete, pending };
}

function simulationMessage(summary: SimulationRegressionSummary | null): string {
  if (!summary) return "No retained-log simulation is available for this revision.";
  if (summary.blockingCount === 0)
    return "Retained-log simulation found no decision-relevant regressions.";
  const findings = [
    summary.newlyDeniedExpectedWorkCount > 0
      ? `${summary.newlyDeniedExpectedWorkCount} newly denied expected action${summary.newlyDeniedExpectedWorkCount === 1 ? "" : "s"}`
      : null,
    summary.removedEscalationCoverageCount > 0
      ? `${summary.removedEscalationCoverageCount} removed escalation control${summary.removedEscalationCoverageCount === 1 ? "" : "s"}`
      : null,
    summary.newlyAllowedHighRiskCount > 0
      ? `${summary.newlyAllowedHighRiskCount} newly allowed high-risk action${summary.newlyAllowedHighRiskCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  return `Simulation found ${findings.join(", ")}.`;
}

function reviewRoute(
  workspaceSlug: string,
  branchId: string | null,
  stage: "review" | "publish",
  anchor: string,
) {
  const params = new URLSearchParams();
  if (branchId) params.set("branch", branchId);
  if (stage === "publish") params.set("stage", stage);
  const query = params.toString();
  return `/${workspaceSlug}/review${query ? `?${query}` : ""}#${anchor}`;
}

function ImpactSignal({ safeToApprove }: { safeToApprove: boolean }) {
  return (
    <div className="impactSignal" data-state={safeToApprove ? "ready" : "review"}>
      <div className="impactSignalIcon" aria-hidden="true">
        {safeToApprove ? <BadgeCheck size={22} /> : <AlertTriangle size={22} />}
      </div>
      <div>
        <p className="eyebrow">Review brief · Product operations</p>
        <h2>{safeToApprove ? "Operational risk: clear" : "Operational risk: review findings"}</h2>
        <p>
          {safeToApprove
            ? "Retained-log simulation found no decision-relevant regressions. Confirm publish readiness in the Publish tab."
            : "Review the linked evidence here, then resolve any workflow requirements in the Publish tab."}
        </p>
      </div>
    </div>
  );
}

function PolicyChangesSection({ diff, href }: { diff: PolicyRevisionDiff; href: string }) {
  const changedCount = diff.summary.added + diff.summary.modified + diff.summary.removed;
  return (
    <article className="impactBriefSection">
      <div className="impactBriefTitle">
        <Route size={17} />
        <h3>What changes in production</h3>
      </div>
      <p className="meta">
        {changedCount === 0
          ? "No rule behavior changes were detected."
          : `${changedCount} rule ${changedCount === 1 ? "change" : "changes"}: ${diff.summary.added} added, ${diff.summary.modified} modified, and ${diff.summary.removed} removed.`}
      </p>
      <div className="impactRuleList">
        {diff.rules
          .filter((rule) => rule.status !== "UNCHANGED")
          .slice(0, 6)
          .map((rule) => (
            <div key={rule.stableRuleId}>
              <code>{rule.stableRuleId}</code>
              <span>{rule.after?.title ?? rule.before?.title ?? "Policy rule"}</span>
              <span className="pill">{rule.status}</span>
            </div>
          ))}
      </div>
      <a href={href}>Inspect the full policy diff</a>
    </article>
  );
}

function SimulationSection({
  summary,
  href,
}: {
  summary: SimulationRegressionSummary | null;
  href: string;
}) {
  const hasRisk = (summary?.blockingCount ?? 0) > 0;
  return (
    <article className="impactBriefSection">
      <div className="impactBriefTitle">
        <FlaskConical size={17} />
        <h3>Simulation risk</h3>
      </div>
      <p className={hasRisk ? "impactRiskCopy" : "meta"}>{simulationMessage(summary)}</p>
      {summary ? (
        <dl className="impactFacts">
          <div>
            <dt>Coverage</dt>
            <dd>{summary.coverage === "RETAINED_LOG" ? "Retained log" : "Sampled"}</dd>
          </div>
          <div>
            <dt>Regression classes</dt>
            <dd>{summary.blockingCount}</dd>
          </div>
        </dl>
      ) : null}
      <a href={href}>Open simulation results</a>
    </article>
  );
}

function RequirementsSection({
  approvalRules,
  approvals,
  readiness,
  href,
}: Pick<ReviewImpactSummaryProps, "approvalRules" | "approvals" | "readiness"> & { href: string }) {
  const approval = approvalProgress(approvalRules, approvals);
  return (
    <article className="impactBriefSection">
      <div className="impactBriefTitle">
        <ClipboardCheck size={17} />
        <h3>Review requirements</h3>
      </div>
      <p className="meta">
        {approval.complete.length} of {approvalRules.length} required approvals complete.
      </p>
      <div className="impactTagList">
        {approval.pending.length ? (
          approval.pending.map((rule) => (
            <span className="pill pillWarn" key={rule.role}>
              {rule.role} pending
            </span>
          ))
        ) : (
          <span className="pill pillAllow">All required approvals complete</span>
        )}
      </div>
      {readiness.blockingReasons.length ? (
        <p className="impactBlocking">{readiness.blockingReasons[0]?.message}</p>
      ) : null}
      <a href={href}>Open approval workflow</a>
    </article>
  );
}

function ControlsSection({
  diff,
  artifactHash,
  viewMode,
  revisionId,
  href,
}: Pick<ReviewImpactSummaryProps, "diff" | "artifactHash" | "viewMode" | "revisionId"> & {
  href: string;
}) {
  const controls = changedControlMappings(diff);
  return (
    <article className="impactBriefSection">
      <div className="impactBriefTitle">
        <ShieldCheck size={17} />
        <h3>Controls and evidence</h3>
      </div>
      <p className="meta">
        {controls.length
          ? `${controls.length} linked control ${controls.length === 1 ? "mapping" : "mappings"} changed with this revision.`
          : "No changed control mappings are attached to this revision."}
      </p>
      {controls.length ? (
        <div className="impactTagList">
          {controls.slice(0, 6).map((control) => (
            <span className="ruleRef" key={`${control.framework}:${control.controlId}`}>
              {control.framework} {control.controlId}
            </span>
          ))}
        </div>
      ) : null}
      <dl className="impactProvenance">
        <div>
          <dt>Revision</dt>
          <dd>
            <code>{formatProvenanceId(revisionId, viewMode, 12, hashToFingerprint)}</code>
          </dd>
        </div>
        {artifactHash ? (
          <div>
            <dt>Artifact</dt>
            <dd>
              <code>{formatArtifactHash(artifactHash, viewMode, hashToFingerprint)}</code>
            </dd>
          </div>
        ) : null}
      </dl>
      <a href={href}>Open publish readiness</a>
    </article>
  );
}

export function ReviewImpactSummary({
  diff,
  blastRadius,
  approvalRules,
  approvals,
  readiness,
  simulationRegression,
  artifactHash,
  viewMode,
  workspaceSlug,
  branchId,
  revisionId,
}: ReviewImpactSummaryProps) {
  const simulationHasRisk = (simulationRegression?.blockingCount ?? 0) > 0;
  const safeToApprove = readiness.status === "READY" && !simulationHasRisk;
  const simulationHref =
    branchId && revisionId
      ? `/${workspaceSlug}/simulate?sim_branch=${branchId}&sim_revision=${revisionId}`
      : `/${workspaceSlug}/simulate`;
  const diffHref = reviewRoute(workspaceSlug, branchId, "review", "diff");
  const approvalsHref = reviewRoute(workspaceSlug, branchId, "publish", "reviews");
  const publishHref = reviewRoute(workspaceSlug, branchId, "publish", "publish");

  return (
    <section className="panel reviewPanel impactSummary" id="impact-summary">
      <ImpactSignal safeToApprove={safeToApprove} />

      <div className="impactBriefGrid">
        <PolicyChangesSection diff={diff} href={diffHref} />
        <SimulationSection summary={simulationRegression} href={simulationHref} />
        <RequirementsSection
          approvalRules={approvalRules}
          approvals={approvals}
          readiness={readiness}
          href={approvalsHref}
        />
        <ControlsSection
          diff={diff}
          artifactHash={artifactHash}
          viewMode={viewMode}
          revisionId={revisionId}
          href={publishHref}
        />
      </div>

      <div className="impactRuntimeNote">
        <strong>Historical runtime exposure</strong>
        {blastRadius ? (
          <div>
            <span>
              {blastRadius.affectedAgents} agents, {blastRadius.affectedConnectors.length}{" "}
              connectors, and {blastRadius.totalDecisions.toLocaleString()} historical decisions
              inform this review.
            </span>
            <div className="impactTagList">
              {blastRadius.affectedConnectors.map((connector) => (
                <span className="ruleRef" key={connector}>
                  {connector}
                </span>
              ))}
              {blastRadius.affectedEnvironments.map((environment) => (
                <span className="ruleRef" key={environment}>
                  {environment}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <span>
            No historical runtime evidence is available for these changed rules. Treat this as a
            net-new or unobserved policy surface.
          </span>
        )}
      </div>
    </section>
  );
}
