import {
  CheckCircle2,
  Download,
  ExternalLink,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { CompliancePageModel } from "@/lib/domains/compliance/service";
import type { PostureModel } from "@/lib/domains/posture/service";
import type {
  ControlEvidenceRollupEntry,
  EvidenceRetentionPlan,
  PolicyBranchTimeline,
  PolicyComplianceEvidenceExport,
} from "@spctre/policy-schema";
import { resolveComplianceArtifacts } from "./demo-compliance-fallback";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { PostureSection } from "./posture-section";
import { TimelineEventInspector } from "./timeline-event-inspector";
import { RetentionPlanTabs } from "./retention-plan-tabs";
import { PageHeader } from "@spctre/ui";
import { formatArtifactHash, formatProvenanceId, isForensicViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { buildActorEmailFormatter } from "@/lib/actors";
import { PlanGate, UpgradePrompt } from "../plan-gate";
import { SealAuditButton } from "./seal-audit-button";
import { QuickStartBanner } from "../quick-start-banner";
import type { WebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { useTranslations } from "next-intl";
import type { ComplianceView } from "./content";

const AGT_COMPATIBILITY_TARGET = "4.1.0";

type AppViewMode = CompliancePageModel["appViewMode"];
type VerificationSummary = CompliancePageModel["verificationSummary"];
type ActiveComplianceExport = PolicyComplianceEvidenceExport | null;
type ActivePolicyBranchTimeline = PolicyBranchTimeline | null;
type ActiveEvidenceRetentionPlan = EvidenceRetentionPlan | null;

type ReadinessGate = {
  label: string;
  detail: string;
  status: "ready" | "attention" | "unavailable";
  href: string;
};

function verificationStatusLabel(verificationSummary: VerificationSummary): string {
  if (!verificationSummary?.hasResults) return "NO RESULTS";
  return verificationSummary.isStale ? "STALE" : verificationSummary.overallOutcome;
}

function getPacketReadiness({
  activeExport,
  activeRetentionPlan,
  verificationSummary,
  compliancePath,
}: {
  activeExport: ActiveComplianceExport;
  activeRetentionPlan: ActiveEvidenceRetentionPlan;
  verificationSummary: VerificationSummary;
  compliancePath: string;
}) {
  const verificationCurrent = Boolean(
    verificationSummary?.hasResults &&
    verificationSummary.overallOutcome === "PASS" &&
    !verificationSummary.isStale,
  );
  const evidenceLinked = Boolean(activeExport && activeExport.evidenceCount > 0);
  const retentionClear = (activeRetentionPlan?.expiredCount ?? 0) === 0;
  const controlMappingCount = activeExport?.controlMappings?.length ?? 0;
  const controlsMapped = controlMappingCount > 0;
  const gates: ReadinessGate[] = [
    {
      label: "Published artifact",
      detail: activeExport
        ? "Current revision is included in this packet."
        : "Publish a revision to create a packet.",
      status: activeExport ? "ready" : "unavailable",
      href: `${compliancePath}/packet#packet`,
    },
    {
      label: "Runtime evidence",
      detail: evidenceLinked
        ? `${activeExport?.evidenceCount} records are linked.`
        : "No runtime evidence is linked yet.",
      status: evidenceLinked ? "ready" : "attention",
      href: `${compliancePath}/evidence#lifecycle`,
    },
    {
      label: "Verification",
      detail: verificationCurrent
        ? "Current verification passed for this artifact."
        : "Run or attach a current passing verification before handoff.",
      status: verificationCurrent ? "ready" : "attention",
      href: `${compliancePath}/packet#verification`,
    },
    {
      label: "Retention",
      detail: retentionClear
        ? "No linked evidence has expired."
        : `${activeRetentionPlan?.expiredCount} linked records have expired.`,
      status: retentionClear ? "ready" : "attention",
      href: `${compliancePath}/evidence#retention`,
    },
    {
      label: "Control mappings",
      detail: controlsMapped
        ? `${controlMappingCount} mappings are included.`
        : "No control mappings are attached. Review before external handoff.",
      status: controlsMapped ? "ready" : "attention",
      href: `${compliancePath}/packet#control-mappings`,
    },
  ];
  const nextGate = gates.find((gate) => gate.status !== "ready");
  return {
    gates,
    ready: Boolean(activeExport && evidenceLinked && verificationCurrent && retentionClear),
    nextGate,
  };
}

function PacketReadiness({
  activeExport,
  activeRetentionPlan,
  verificationSummary,
  compliancePath,
}: {
  activeExport: ActiveComplianceExport;
  activeRetentionPlan: ActiveEvidenceRetentionPlan;
  verificationSummary: VerificationSummary;
  compliancePath: string;
}) {
  const readiness = getPacketReadiness({
    activeExport,
    activeRetentionPlan,
    verificationSummary,
    compliancePath,
  });
  const nextAction = readiness.ready
    ? { href: "/api/compliance/export", label: "Download ready JSON packet" }
    : {
        href: readiness.nextGate?.href ?? `${compliancePath}/packet#packet`,
        label: `Review ${readiness.nextGate?.label.toLowerCase() ?? "packet"}`,
      };

  return (
    <section className="packetReadiness" aria-labelledby="packet-readiness-title">
      <div className="packetReadinessIntro">
        <p className="eyebrow">Packet readiness</p>
        <h2 id="packet-readiness-title">
          {readiness.ready
            ? "Ready for external handoff"
            : "Action required before external handoff"}
        </h2>
        <p className="meta">
          {readiness.ready
            ? "The current packet has linked evidence, current passing verification, and no expired evidence."
            : "Resolve the highlighted check before relying on this packet as an audit handoff."}
        </p>
      </div>
      <div className="packetReadinessGates" aria-label="Packet readiness checks">
        {readiness.gates.map((gate) => (
          <a
            className={`packetReadinessGate packetReadinessGate${gate.status}`}
            href={gate.href}
            key={gate.label}
          >
            {gate.status === "ready" ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
            <span>
              <strong>{gate.label}</strong>
              <small>{gate.detail}</small>
            </span>
          </a>
        ))}
      </div>
      <a className="button buttonPrimary" href={nextAction.href}>
        {nextAction.label}
      </a>
    </section>
  );
}

function ComplianceViewNav({
  compliancePath,
  view,
}: {
  compliancePath: string;
  view: ComplianceView;
}) {
  const tabs: { href: string; label: string; view: ComplianceView }[] = [
    { href: compliancePath, label: "Overview", view: "overview" },
    { href: `${compliancePath}/packet`, label: "Audit package", view: "packet" },
    { href: `${compliancePath}/evidence`, label: "Evidence & retention", view: "evidence" },
    { href: `${compliancePath}/delivery`, label: "Delivery", view: "delivery" },
  ];
  return (
    <nav className="complianceViewNav" aria-label="Compliance views">
      {tabs.map((tab) => (
        <a
          aria-current={tab.view === view ? "page" : undefined}
          className={tab.view === view ? "uiTab uiTabActive" : "uiTab"}
          href={tab.href}
          key={tab.view}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

function PacketHero({
  activeExport,
  activeTimeline,
  verificationStatus,
  appViewMode,
}: {
  activeExport: ActiveComplianceExport;
  activeTimeline: ActivePolicyBranchTimeline;
  verificationStatus: string;
  appViewMode: AppViewMode;
}) {
  const t = useTranslations("compliance.hero");

  return (
    <section className="complianceHero" aria-label={t("aria_label")}>
      <div className="complianceHeroMain">
        <p className="eyebrow">{t("eyebrow")}</p>
        {activeExport && activeTimeline ? (
          <>
            <h2>
              {t("packet_title")}{" "}
              <code>{formatProvenanceId(activeExport.id, appViewMode, 16, hashToFingerprint)}</code>
            </h2>
            <p className="meta">
              {t("packet_meta", {
                date: activeExport.retentionUntil?.slice(0, 10) ?? "pending",
                events: activeTimeline.events.length,
                records: activeExport.evidenceCount,
              })}
            </p>
          </>
        ) : (
          <>
            <h2>{t("empty_title")}</h2>
            <p className="meta">{t("empty_description")}</p>
          </>
        )}
        <div className="complianceHeroActions">
          <span
            className={
              verificationStatus === "PASS"
                ? "pill pillAllow"
                : verificationStatus === "FAIL"
                  ? "pill pillBlock"
                  : verificationStatus === "STALE"
                    ? "pill pillWarn"
                    : "pill pillNeutral"
            }
          >
            <ShieldCheck size={13} />
            {verificationStatus}
          </span>
          <span className="pill pillNeutral">
            {t("sections", { count: activeExport?.packageSections.length ?? 0 })}
          </span>
        </div>
      </div>
    </section>
  );
}

function PacketContentsSection({
  activeExport,
  activeTimeline,
  appViewMode,
}: {
  activeExport: ActiveComplianceExport;
  activeTimeline: ActivePolicyBranchTimeline;
  appViewMode: AppViewMode;
}) {
  return (
    <section className="panel compliancePanel" id="packet">
      {!activeExport || !activeTimeline ? (
        <>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Export · Packet contents</p>
              <h2>Packet contents</h2>
            </div>
          </div>
          <div className="emptyState">
            <h3>No compliance packet generated</h3>
            <p className="meta">
              Packet contents appear after a policy revision is published and runtime evidence is
              recorded.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Export · Packet contents</p>
              <h2>
                Packet contents
                <span className="headCount">{activeExport.packageSections.length}</span>
              </h2>
              <p className="meta">
                Artifact{" "}
                {formatArtifactHash(activeExport.artifactHash, appViewMode, hashToFingerprint)} ·
                generated {activeExport.generatedAt?.slice(0, 10) || "pending"}.
              </p>
            </div>
          </div>

          <div className="complianceLayout">
            <div className="complianceCard">
              <PackageCheck size={18} />
              <div>
                <span className="meta">Artifact</span>
                <strong>
                  {formatArtifactHash(activeExport.artifactHash, appViewMode, hashToFingerprint)}
                </strong>
              </div>
              <div>
                <span className="meta">Generated</span>
                <strong>{activeExport.generatedAt?.slice(0, 10) || "pending"}</strong>
              </div>
              <div>
                <span className="meta">Replay volume</span>
                <strong>{activeExport.simulationEventCount}</strong>
              </div>
            </div>

            <div className="packageSections">
              {activeExport.packageSections.map((section: string) => (
                <span className="ruleRef" key={section}>
                  {section}
                </span>
              ))}
            </div>
          </div>

          <div className="complianceOutcomes">
            <p className="meta">
              {activeExport.deniedDecisionCount} deny · {activeExport.warnedDecisionCount} warn ·
              tied to revision{" "}
              {formatProvenanceId(activeTimeline.revisionId, appViewMode, 12, hashToFingerprint)}.
            </p>
          </div>

          <PlanGate
            feature="compliancePdfExport"
            fallback={<UpgradePrompt feature="compliancePdfExport" variant="inline" />}
          >
            <p className="meta">PDF export is available for this compliance packet.</p>
          </PlanGate>
        </>
      )}
    </section>
  );
}

function LifecycleTimelineSection({
  activeTimeline,
  appViewMode,
  formatActorId,
}: {
  activeTimeline: ActivePolicyBranchTimeline;
  appViewMode: AppViewMode;
  formatActorId: (actor: string) => string;
}) {
  return (
    <section className="panel compliancePanel" id="lifecycle">
      {!activeTimeline ? (
        <>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Audit · Lifecycle timeline</p>
              <h2>Lifecycle timeline</h2>
            </div>
          </div>
          <div className="emptyState">
            <h3>No lifecycle events yet</h3>
            <p className="meta">
              Timeline events appear once policy branches are reviewed and published.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Audit · Lifecycle timeline</p>
              <h2>
                Lifecycle timeline
                <span className="headCount">{activeTimeline.events.length}</span>
              </h2>
              <p className="meta">
                <code>
                  {formatProvenanceId(activeTimeline.branchId, appViewMode, 16, hashToFingerprint)}
                </code>{" "}
                /{" "}
                <code>
                  {formatProvenanceId(
                    activeTimeline.revisionId,
                    appViewMode,
                    16,
                    hashToFingerprint,
                  )}
                </code>{" "}
                from {activeTimeline.firstEventAt?.slice(0, 10)} to{" "}
                {activeTimeline.latestEventAt?.slice(0, 10)}
              </p>
            </div>
          </div>

          <div className="timelineList complianceTimelineList">
            {activeTimeline.events.map((event) => (
              <TimelineEventInspector
                key={event.id}
                event={
                  !isForensicViewMode(appViewMode) && event.actor
                    ? {
                        ...event,
                        actor: formatActorId(event.actor),
                        detail: event.detail.replaceAll(event.actor, formatActorId(event.actor)),
                      }
                    : event
                }
                viewMode={appViewMode}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RetentionSection({
  activeRetentionPlan,
  appViewMode,
  retentionTab,
  retentionRulesHref,
  retentionDecisionsHref,
}: {
  activeRetentionPlan: ActiveEvidenceRetentionPlan;
  appViewMode: AppViewMode;
  retentionTab: "rules" | "decisions";
  retentionRulesHref: string;
  retentionDecisionsHref: string;
}) {
  return (
    <section className="panel compliancePanel" id="retention">
      {!activeRetentionPlan ? (
        <>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Workflow · Retention</p>
              <h2>Retention plan</h2>
            </div>
          </div>
          <div className="emptyState">
            <h3>No retention plan generated</h3>
            <p className="meta">
              A retention plan is generated once retention rules are configured and evidence is
              recorded.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">Workflow · Retention</p>
              <h2>
                Retention plan{" "}
                <code>
                  {formatProvenanceId(activeRetentionPlan.id, appViewMode, 16, hashToFingerprint)}
                </code>
              </h2>
              <p className="meta">
                Generated {activeRetentionPlan.generatedAt?.slice(0, 10)} ·{" "}
                {activeRetentionPlan.exportableCount} exportable records.
              </p>
            </div>
          </div>

          <div className="retentionSummary" aria-label="Evidence retention summary">
            <div>
              <span className="meta">Active</span>
              <strong>{activeRetentionPlan.activeCount}</strong>
            </div>
            <div>
              <span className="meta">Expiring</span>
              <strong>{activeRetentionPlan.expiringCount}</strong>
            </div>
            <div>
              <span className="meta">Expired</span>
              <strong>{activeRetentionPlan.expiredCount}</strong>
            </div>
            <div>
              <span className="meta">Longest</span>
              <strong>{activeRetentionPlan.longestRetentionDays}d</strong>
            </div>
          </div>

          <RetentionPlanTabs
            rules={activeRetentionPlan.rules}
            decisions={activeRetentionPlan.decisions}
            appViewMode={appViewMode}
            activeTab={retentionTab}
            rulesHref={retentionRulesHref}
            decisionsHref={retentionDecisionsHref}
          />
        </>
      )}

      <PlanGate
        feature="longTermForensicArchival"
        fallback={<UpgradePrompt feature="longTermForensicArchival" variant="inline" />}
      >
        <div className="upgradePrompt upgradePromptInline">
          <div>
            <p className="eyebrow">Cloud · Forensic archival</p>
            <h3>Extended forensic retention</h3>
            <p className="meta">
              Managed tamper-evident storage beyond the local retention window.
            </p>
          </div>
        </div>
      </PlanGate>
    </section>
  );
}

function verificationPillClass(verificationSummary: VerificationSummary): string {
  if (!verificationSummary?.hasResults) return "pill pillNeutral";
  if (verificationSummary.overallOutcome === "PASS" && !verificationSummary.isStale)
    return "pill pillAllow";
  if (verificationSummary.overallOutcome === "FAIL") return "pill pillBlock";
  return "pill pillWarn";
}

function outcomePillClass(outcome: string): string {
  if (outcome === "PASS") return "pill pillAllow";
  if (outcome === "FAIL") return "pill pillBlock";
  return "pill pillWarn";
}

function agtDriftStatusLabel(
  verificationSummary: VerificationSummary,
  latestAgtVersion: string,
): string {
  if (!verificationSummary?.hasResults) return "UNVERIFIED";
  if (latestAgtVersion === "unreported") return "UNKNOWN";
  return latestAgtVersion === AGT_COMPATIBILITY_TARGET && !verificationSummary.isStale
    ? "CURRENT"
    : "RECHECK";
}

function VerificationSection({
  verificationSummary,
}: {
  verificationSummary: VerificationSummary;
}) {
  const latestAgtVersion = verificationSummary?.latestAgtVersion ?? "unreported";
  const latestPoliciesVersion = verificationSummary?.latestAgtPoliciesVersion ?? "unreported";
  const latestCedarVersion = verificationSummary?.latestCedarPolicyVersion ?? "unreported";
  const agtDriftStatus = agtDriftStatusLabel(verificationSummary, latestAgtVersion);

  return (
    <section className="panel compliancePanel" id="verification">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">AGT verification</p>
          <h2>Verification status</h2>
          <p className="meta">
            {verificationSummary?.hasResults
              ? verificationSummary.overallOutcome === "PASS" && !verificationSummary.isStale
                ? `Current verification passed ${verificationSummary.latestRunAt ? new Date(verificationSummary.latestRunAt).toLocaleString() : "at an unknown time"}. This artifact can be included in an external handoff.`
                : `Verification needs attention. Last run ${verificationSummary.latestRunAt ? new Date(verificationSummary.latestRunAt).toLocaleString() : "is unreported"}; review or rerun it before external handoff.`
              : "No verification result is attached. Run or attach verification before external handoff."}
          </p>
        </div>
        <span className={verificationPillClass(verificationSummary)}>
          <ShieldCheck size={13} />
          {verificationStatusLabel(verificationSummary)}
        </span>
      </div>
      <details className="verificationDetails">
        <summary>Verification details</summary>
        <div className="complianceSummary" aria-label="AGT compatibility drift status">
          <div>
            <span className="meta">Target</span>
            <strong>AGT {AGT_COMPATIBILITY_TARGET}</strong>
          </div>
          <div>
            <span className="meta">Latest verified</span>
            <strong>
              {latestAgtVersion === "unreported" ? "Unreported" : `AGT ${latestAgtVersion}`}
            </strong>
          </div>
          <div>
            <span className="meta">agt-policies</span>
            <strong>{latestPoliciesVersion}</strong>
          </div>
          <div>
            <span className="meta">Cedar policy</span>
            <strong>{latestCedarVersion}</strong>
          </div>
          <div>
            <span className="meta">Drift</span>
            <strong>{agtDriftStatus}</strong>
          </div>
        </div>
        {verificationSummary?.hasResults &&
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
                    <span className={outcomePillClass(result.outcome)}>{result.outcome}</span>
                  </td>
                  <td className="meta">{new Date(result.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </details>
      <p className="meta compliancePostHint">
        Verification is posted by the platform verification workflow.{" "}
        <a href="/api-docs">View verification API reference</a> for manual integration.
      </p>
    </section>
  );
}

function DeliverySection({
  destinations,
  attempts,
}: {
  destinations: CompliancePageModel["grcDestinations"];
  attempts: CompliancePageModel["grcDeliveryAttempts"];
}) {
  const failureCount = attempts.filter((attempt) => attempt.status !== "DELIVERED").length;
  return (
    <section className="panel compliancePanel" id="delivery">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">External evidence handoff</p>
          <h2>Delivery</h2>
          <p className="meta">
            {destinations.length
              ? `${destinations.filter((destination) => destination.enabled).length} active destinations · ${attempts.length} recent attempts${failureCount ? ` · ${failureCount} need attention` : ""}.`
              : "No delivery destination is configured for this workspace."}
          </p>
        </div>
        <ShieldCheck size={20} className="sectionIcon" />
      </div>
      {destinations.length ? (
        <div className="deliveryList">
          {destinations.map((destination) => (
            <div className="deliveryRow" key={destination.id}>
              <div>
                <strong>{destination.label}</strong>
                <p className="meta">
                  Webhook ·{" "}
                  {destination.hasCredential ? "Credential configured" : "No credential configured"}
                </p>
              </div>
              <span className={destination.enabled ? "pill pillAllow" : "pill pillNeutral"}>
                {destination.enabled ? "ACTIVE" : "PAUSED"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <h3>No delivery destination configured</h3>
          <p className="meta">
            This packet stays in Spctre until a delivery destination is configured by a platform
            administrator.
          </p>
        </div>
      )}
      <details className="developerDelivery">
        <summary>Developer delivery integration</summary>
        <p className="meta">
          Use these endpoints only from an authenticated integration. They operate on the current
          workspace, not a selected packet.
        </p>
        <div className="toolbar">
          <a className="button" href="/api/compliance/grc-destinations">
            Destination API <ExternalLink size={14} />
          </a>
          <a className="button" href="/api/compliance/grc-destinations/attempts">
            Delivery attempts API <ExternalLink size={14} />
          </a>
          <a className="button" href="/api/compliance/export?format=grc">
            Download GRC bridge export <Download size={14} />
          </a>
        </div>
      </details>
    </section>
  );
}

function ControlMappingsSection({
  activeExport,
  controlEvidenceRollup,
}: {
  activeExport: ActiveComplianceExport;
  controlEvidenceRollup: ControlEvidenceRollupEntry[];
}) {
  const mappings = activeExport?.controlMappings ?? [];
  const rollupByControl = new Map(
    controlEvidenceRollup.map((entry) => [`${entry.framework}:${entry.controlId}`, entry]),
  );
  return (
    <section className="panel compliancePanel" id="control-mappings">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Reviewed policy metadata</p>
          <h2>Control mappings</h2>
          <p className="meta">
            Rule-to-control links included in evidence and GRC bridge exports, with runtime evidence
            proving each control operated.
          </p>
        </div>
        <ShieldCheck size={20} className="sectionIcon" />
      </div>
      {mappings.length ? (
        <div className="packRuleMeta">
          {mappings.map((mapping) => {
            const rollup = rollupByControl.get(`${mapping.framework}:${mapping.controlId}`);
            return (
              <div key={`${mapping.stableRuleId}-${mapping.framework}-${mapping.controlId}`}>
                <span className="meta">
                  {mapping.framework} · {mapping.controlId}
                </span>
                <code className="smallCode">{mapping.stableRuleId}</code>
                {mapping.rationale ? <span className="meta">{mapping.rationale}</span> : null}
                {rollup ? (
                  <span className="meta">
                    {rollup.decisionCount === 0
                      ? "No runtime evidence yet for this control"
                      : `${rollup.decisionCount} decision${rollup.decisionCount === 1 ? "" : "s"} (${rollup.deniedCount} denied, ${rollup.warnedCount} warned)${rollup.latestEvidenceAt ? ` · latest ${new Date(rollup.latestEvidenceAt).toLocaleDateString()}` : ""}`}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="meta">No explicit control mappings are attached to the published rules.</p>
      )}
    </section>
  );
}

export function CompliancePresenter({
  model,
  onboardingStatus,
  controlPlaneUrl,
  view,
  compliancePath,
  retentionTab,
  retentionRulesHref,
  retentionDecisionsHref,
}: {
  model: CompliancePageModel<PostureModel>;
  onboardingStatus: WebOnboardingStatus;
  controlPlaneUrl: string;
  view: ComplianceView;
  compliancePath: string;
  retentionTab: "rules" | "decisions";
  retentionRulesHref: string;
  retentionDecisionsHref: string;
}) {
  const {
    workspaceContext,
    appViewMode,
    packet,
    persistedRetentionPlan,
    activeActor,
    verificationSummary,
    grcDestinations,
    grcDeliveryAttempts,
    posture,
  } = model;
  const formatActorId = buildActorEmailFormatter(activeActor?.actors ?? []);
  // Sample data is shown only in the demo workspace (matching every other
  // surface). Real tenants get explicit empty states, never fabricated data.
  const { activeTimeline, activeExport, activeRetentionPlan } = resolveComplianceArtifacts(
    workspaceContext.tenantId,
    packet,
    persistedRetentionPlan,
  );
  const verificationStatus = verificationStatusLabel(verificationSummary);
  const auditLedgerHref = `/${workspaceContext.workspaceSlug}/operations`;
  const packetHref = `${compliancePath}/packet`;

  return (
    <>
      <PageHeader
        eyebrow={formatWorkspaceEyebrow(workspaceContext)}
        title="Audit package"
        actions={
          <>
            {activeExport && view === "packet" ? (
              <>
                <SealAuditButton
                  packetId={activeExport.id}
                  branchId={activeExport.artifact.branchId}
                  revisionId={activeExport.artifact.revisionId}
                  artifactHash={activeExport.artifactHash}
                  evidenceCount={activeExport.evidenceCount}
                  appViewMode={appViewMode}
                  auditLedgerHref={auditLedgerHref}
                />
                <a className="button buttonPrimary" href="/api/compliance/export">
                  <Download size={16} />
                  Download JSON packet
                </a>
                <PlanGate feature="compliancePdfExport" prompt="none">
                  <a className="button" href="/api/compliance/export?format=pdf">
                    <Download size={16} />
                    Download PDF packet
                  </a>
                </PlanGate>
              </>
            ) : activeExport ? (
              <a className="button buttonPrimary" href={packetHref}>
                <PackageCheck size={16} />
                Review audit packet
              </a>
            ) : null}
          </>
        }
      />

      <ComplianceViewNav compliancePath={compliancePath} view={view} />

      {view === "overview" ? (
        <>
          <PacketHero
            activeExport={activeExport}
            activeTimeline={activeTimeline}
            verificationStatus={verificationStatus}
            appViewMode={appViewMode}
          />
          <PacketReadiness
            activeExport={activeExport}
            activeRetentionPlan={activeRetentionPlan}
            verificationSummary={verificationSummary}
            compliancePath={compliancePath}
          />
          <PostureSection posture={posture} />
          {onboardingStatus.realEvidenceCount === 0 ? (
            <QuickStartBanner
              controlPlaneUrl={controlPlaneUrl}
              status={onboardingStatus}
              surface="compliance"
              workspaceSlug={workspaceContext.workspaceSlug}
            />
          ) : null}
        </>
      ) : null}

      {view === "packet" ? (
        <>
          <PacketContentsSection
            activeExport={activeExport}
            activeTimeline={activeTimeline}
            appViewMode={appViewMode}
          />
          <ControlMappingsSection
            activeExport={activeExport}
            controlEvidenceRollup={packet?.controlEvidenceRollup ?? []}
          />
          <VerificationSection verificationSummary={verificationSummary} />
        </>
      ) : null}

      {view === "evidence" ? (
        <>
          <LifecycleTimelineSection
            activeTimeline={activeTimeline}
            appViewMode={appViewMode}
            formatActorId={formatActorId}
          />
          <RetentionSection
            activeRetentionPlan={activeRetentionPlan}
            appViewMode={appViewMode}
            retentionTab={retentionTab}
            retentionRulesHref={retentionRulesHref}
            retentionDecisionsHref={retentionDecisionsHref}
          />
        </>
      ) : null}

      {view === "delivery" ? (
        <DeliverySection destinations={grcDestinations} attempts={grcDeliveryAttempts} />
      ) : null}
    </>
  );
}
