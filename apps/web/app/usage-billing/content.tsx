import {
  Activity,
  Boxes,
  Database,
  Download,
  Gauge,
  KeyRound,
  PackageCheck,
  Send,
  ShieldCheck,
} from "lucide-react";
import { POLICY_PACKS } from "@spctre/policy-schema";
import {
  COMMERCIAL_PLAN_CODES,
  PLAN_ENTITLEMENTS,
  enforcedEntitlementValue,
  planEntitlements,
  type CommercialPlanCode,
  type PlanEntitlements,
} from "@/lib/entitlements/catalog";
import { describeRetentionWindow, resolveRetentionWindowDays } from "@/lib/entitlements/retention";
import { getUsageBillingInputs } from "@/lib/domains/usage-billing/service";

import { getWorkspaceContext } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { SettingsHeader } from "@/components/settings-header";
import { requestUsageBillingReview } from "./actions";
import { getSiteUrl } from "@/lib/platform/config";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { QuickStartBanner } from "../quick-start-banner";
import { getTranslations } from "next-intl/server";

type UsageBillingTranslations = Awaited<ReturnType<typeof getTranslations>>;

const planRank = { HOSTED_TRIAL: 1, TEAM: 2, BUSINESS: 3, ENTERPRISE: 4 };

const commercialLevers = [
  {
    label: "Retained governed events",
    description:
      "Governed evidence volume kept searchable and replayable against policy (rolling capacity).",
    icon: Database,
  },
  {
    label: "Retention window",
    description: "Evidence depth distinguishes operational review from audit-grade compliance.",
    icon: ShieldCheck,
  },
  {
    label: "Bulk simulation",
    description: "Replay proposed policy against the full retained production event log.",
    icon: Activity,
  },
  {
    label: "Compliance exports",
    description: "Auditor-ready evidence packets for formal compliance cycles.",
    icon: PackageCheck,
  },
];

interface UsageRow {
  label: string;
  value: number;
  /** The enforced limit, or null when the product does not hold the tenant to one. */
  included: number | null;
  businessIncluded: number;
  detail: string;
  /**
   * What the meter reads when there is no enforced limit. A null `included`
   * covers three different situations — a duration rather than a count, a
   * capacity that is measured but not capped, and a sample-only allowance —
   * and calling all three "sample only" was misleading.
   */
  unmeteredLabel?: string;
  sampleOnly?: boolean;
}

type UsageBillingInputs = Awaited<ReturnType<typeof getUsageBillingInputs>>;
type UsageWorkspaceContext = Awaited<ReturnType<typeof getWorkspaceContext>>;

// Derive the usage meters, recommended plan, and readiness labels from the
// measured usage.
function computeUsagePosture(inputs: UsageBillingInputs, workspaceContext: UsageWorkspaceContext) {
  const { usage, profile, branches, agents, simulations, usagePeriod } = inputs;
  const activePlan = planEntitlements(profile.planCode);
  const importedPackIds = new Set(branches.map((branch) => branch.name));
  const importedPackCount = POLICY_PACKS.filter((pack) => importedPackIds.has(pack.id)).length;
  const simulationEventCount = simulations.reduce((sum, run) => sum + run.sourceEventCount, 0);
  const connectorCount = new Set(agents.flatMap((agent) => agent.connectors)).size;

  // Prefer the reconciled measurement over the request-time count. The
  // measurement is what a bill would be drawn against; the count is a display
  // fallback for a tenant whose period has not been measured yet.
  const measuredRetained = usagePeriod?.retainedCount ?? null;
  const retainedEvents = measuredRetained ?? usage.retainedAuditEventCount;
  const totalWorkspaces = usage.workspaceCount || workspaceContext.workspaces.length;

  const usageRows: UsageRow[] = [
    {
      label: "Workspaces",
      value: totalWorkspaces,
      // enforcedEntitlementValue returns null for an entitlement the product
      // does not measure, and a null `included` renders as plan information
      // rather than as a limit the tenant is being held to.
      included: enforcedEntitlementValue(activePlan.workspaces),
      businessIncluded: PLAN_ENTITLEMENTS.BUSINESS.workspaces.value,
      detail: workspaceContext.tenantSlug,
    },
    {
      label: "Retained governed events",
      value: retainedEvents,
      included: enforcedEntitlementValue(activePlan.retainedEvents),
      businessIncluded: PLAN_ENTITLEMENTS.BUSINESS.retainedEvents.value,
      // Measured on every plan, but only capped on the trial. Showing a
      // denominator on the others would assert a limit nothing applies.
      unmeteredLabel: `${retainedEvents}`,
      detail:
        measuredRetained === null
          ? `${connectorCount} active connectors · awaiting measurement`
          : `${connectorCount} active connectors`,
    },
    {
      label: "Retention window",
      value: 0,
      included: null,
      businessIncluded: 0,
      unmeteredLabel: `${resolveRetentionWindowDays(profile)} days`,
      detail: `${describeRetentionWindow(profile)} · searchable evidence history`,
    },
    {
      label: "Simulation events",
      value: simulationEventCount,
      included: enforcedEntitlementValue(activePlan.simulationEvents),
      businessIncluded: PLAN_ENTITLEMENTS.BUSINESS.simulationEvents.value ?? 0,
      sampleOnly: activePlan.simulationEvents.value === null,
      detail: `${simulations.length} replay runs`,
    },
  ];

  // Recommend the smallest plan whose entitlements cover current usage, rather
  // than comparing against thresholds maintained separately from the catalog.
  // Those thresholds had drifted from every published figure.
  const usagePlan =
    COMMERCIAL_PLAN_CODES.find((plan) => {
      const candidate = PLAN_ENTITLEMENTS[plan];
      return (
        totalWorkspaces <= candidate.workspaces.value &&
        retainedEvents <= candidate.retainedEvents.value &&
        simulationEventCount <= (candidate.simulationEvents.value ?? 0)
      );
    }) ?? "ENTERPRISE";
  const recommendedPlan: CommercialPlanCode =
    planRank[usagePlan] > planRank[profile.planCode] ? usagePlan : profile.planCode;

  const overIncluded = usageRows.filter(
    (row) => row.included !== null && row.value > row.included,
  ).length;
  const readinessLabel =
    agents.length === 0
      ? "Hosted trial"
      : overIncluded > 0
        ? "Billing fit"
        : retainedEvents > 0
          ? "Active evaluation"
          : "Setup";
  const primaryHeroLabel = overIncluded > 0 ? "Paid signal" : activePlan.displayName;
  const showReadinessHeroPill = readinessLabel.toLowerCase() !== primaryHeroLabel.toLowerCase();

  return {
    activePlan,
    importedPackCount,
    usageRows,
    recommendedPlan,
    overIncluded,
    readinessLabel,
    primaryHeroLabel,
    showReadinessHeroPill,
  };
}

function UsageMetersPanel({
  usageRows,
  activePlan,
  t,
}: {
  usageRows: UsageRow[];
  activePlan: PlanEntitlements;
  t: UsageBillingTranslations;
}) {
  return (
    <div className="panel">
      <div>
        <p className="eyebrow">{t("meters.eyebrow")}</p>
        <h2>{t("meters.title")}</h2>
      </div>
      <div className="commercialMeterList">
        {usageRows.map((row) => {
          const unmetered = row.included === null;
          const percent = unmetered
            ? 0
            : Math.min(100, Math.round((row.value / Math.max(row.included!, 1)) * 100));
          const over = !unmetered && row.value > row.included!;
          return (
            <article className="commercialMeter" key={row.label}>
              <div className="rowHeader">
                <div>
                  <h3>{row.label}</h3>
                  <p className="meta">{row.detail}</p>
                </div>
                <span className={over ? "pill pillWarn" : "pill pillNeutral"}>
                  {unmetered
                    ? (row.unmeteredLabel ??
                      (row.sampleOnly ? t("meters.sample_only") : t("meters.not_metered")))
                    : `${row.value} / ${row.included}`}
                </span>
              </div>
              {!unmetered && (
                <div className="commercialMeterTrack" aria-hidden="true">
                  <span className="commercialMeterFill" style={{ width: `${percent}%` }} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PlanUpgradeSection({
  recommendedPlan,
  currentPlan,
  workspaceSlug,
  siteUrl,
}: {
  recommendedPlan: CommercialPlanCode;
  currentPlan: CommercialPlanCode;
  workspaceSlug: string;
  siteUrl: string;
}) {
  if (
    recommendedPlan !== currentPlan &&
    (recommendedPlan === "TEAM" || recommendedPlan === "BUSINESS")
  ) {
    return (
      <section className="commercialAnchorGroup" aria-label="Upgrade plan">
        <div className="commercialAnchorGroupHeader">
          <p className="eyebrow">Self-serve upgrade</p>
          <h3>Upgrade to {PLAN_ENTITLEMENTS[recommendedPlan].displayName}</h3>
        </div>
        <p className="meta">
          Your usage fits the {PLAN_ENTITLEMENTS[recommendedPlan].displayName} plan. No sales call
          needed.
        </p>
        <a
          className="button buttonPrimary"
          href={`${siteUrl}/pricing?plan=${recommendedPlan}#checkout`}
        >
          <Send size={16} />
          Upgrade to {PLAN_ENTITLEMENTS[recommendedPlan].displayName}
        </a>
      </section>
    );
  }
  if (recommendedPlan === "ENTERPRISE" && recommendedPlan !== currentPlan) {
    return (
      <section className="commercialAnchorGroup" aria-label="Contact sales">
        <div className="commercialAnchorGroupHeader">
          <p className="eyebrow">Contact sales</p>
          <h3>Request Enterprise pricing</h3>
        </div>
        <form action={requestUsageBillingReview} className="commercialReviewForm">
          <input name="workspaceSlug" type="hidden" value={workspaceSlug} />
          <input name="targetPlan" type="hidden" value="ENTERPRISE" />
          <label>
            <span className="meta">Billing note</span>
            <input
              name="note"
              placeholder="Custom retention, enterprise identity, private deployment"
              type="text"
            />
          </label>
          <button className="button buttonPrimary" type="submit">
            <Send size={16} />
            Contact sales
          </button>
        </form>
      </section>
    );
  }
  return null;
}

function ValueAnchorsPanel({
  recommendedPlan,
  currentPlan,
  workspaceSlug,
  siteUrl,
  t,
}: {
  recommendedPlan: CommercialPlanCode;
  currentPlan: CommercialPlanCode;
  workspaceSlug: string;
  siteUrl: string;
  t: UsageBillingTranslations;
}) {
  return (
    <div className="panel">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("anchors.eyebrow")}</p>
          <h2>{t("anchors.title")}</h2>
          <p className="meta">{t("anchors.description")}</p>
        </div>
        <span className="pill pillNeutral">
          {t("anchors.count", { count: commercialLevers.length })}
        </span>
      </div>

      <section className="commercialAnchorGroup" aria-label={t("anchors.aria_label")}>
        <div className="commercialAnchorGroupHeader">
          <p className="eyebrow">{t("anchors.group_eyebrow")}</p>
          <h3>{t("anchors.group_title")}</h3>
        </div>
        <div className="commercialLeverList">
          {commercialLevers.map(({ label, description, icon: Icon }) => (
            <article className="contextNode" key={label}>
              <Icon size={16} />
              <div>
                <h3>{label}</h3>
                <p className="meta">{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <PlanUpgradeSection
        recommendedPlan={recommendedPlan}
        currentPlan={currentPlan}
        workspaceSlug={workspaceSlug}
        siteUrl={siteUrl}
      />
    </div>
  );
}

function BillingPosturePanel({
  profile,
  recommendedPlan,
  overIncluded,
  readinessLabel,
  agentCount,
  retainedEventCount,
  importedPackCount,
  t,
}: {
  profile: UsageBillingInputs["profile"];
  recommendedPlan: CommercialPlanCode;
  overIncluded: number;
  readinessLabel: string;
  agentCount: number;
  retainedEventCount: number;
  importedPackCount: number;
  t: UsageBillingTranslations;
}) {
  return (
    <section className="panel">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("posture.eyebrow")}</p>
          <h2>
            {t("posture.title")}
            <span className="headCount">{t("posture.over_plan", { count: overIncluded })}</span>
          </h2>
          <p className="meta">{t("posture.description")}</p>
        </div>
      </div>

      <div className="commercialPlanStrip">
        <div>
          <span className="meta">{t("posture.current_plan")}</span>
          <strong>{PLAN_ENTITLEMENTS[profile.planCode].displayName}</strong>
          <p className="meta">
            {profile.lifecycleStatus.toLowerCase()} / sales {profile.salesStatus.toLowerCase()}
          </p>
        </div>
        <div>
          <span className="meta">{t("posture.recommended_plan")}</span>
          <strong>{PLAN_ENTITLEMENTS[recommendedPlan].displayName}</strong>
          <p className="meta">{t("posture.dimensions_beyond", { count: overIncluded })}</p>
        </div>
        <div>
          <span className="meta">{t("posture.billing_status")}</span>
          <strong>
            {profile.salesStatus === "REQUESTED" ? t("posture.review_requested") : readinessLabel}
          </strong>
          <p className="meta">
            {profile.updatedAt
              ? t("posture.updated", { date: profile.updatedAt.slice(0, 10) })
              : t("posture.no_event")}
          </p>
        </div>
      </div>

      <div className="commercialHero">
        <div>
          <span className="meta">{t("posture.primary_dimension")}</span>
          <strong>{agentCount}</strong>
          <p className="meta">{t("posture.agent_detail")}</p>
        </div>
        <div>
          <span className="meta">{t("posture.evidence_retained")}</span>
          <strong>{retainedEventCount}</strong>
          <p className="meta">{t("posture.evidence_detail")}</p>
        </div>
        <div>
          <span className="meta">{t("posture.policy_surface")}</span>
          <strong>{importedPackCount}</strong>
          <p className="meta">{t("posture.policy_detail")}</p>
        </div>
      </div>
    </section>
  );
}

function BillingEventLog({
  events,
  t,
}: {
  events: UsageBillingInputs["events"];
  t: UsageBillingTranslations;
}) {
  return (
    <section className="panel">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("events.eyebrow")}</p>
          <h2>
            {t("events.title")}
            <span className="headCount">{events.length}</span>
          </h2>
        </div>
      </div>
      {events.length ? (
        <div className="commercialEventList">
          {events.map((event) => (
            <article className="row" key={event.id}>
              <div className="rowHeader">
                <div>
                  <h3>{event.eventType.replace(/_/g, " ").toLowerCase()}</h3>
                  <p className="meta">
                    {event.actor ?? t("events.system")} /{" "}
                    {event.createdAt.slice(0, 16).replace("T", " ")}
                  </p>
                </div>
                {event.targetPlan ? (
                  <span className="pill pillNeutral">{event.targetPlan}</span>
                ) : null}
              </div>
              {typeof event.metadata.note === "string" && event.metadata.note ? (
                <p className="meta">{event.metadata.note}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <KeyRound size={20} className="sectionIcon" />
          <h3>{t("events.empty.title")}</h3>
          <p className="meta">{t("events.empty.description")}</p>
        </div>
      )}
    </section>
  );
}

export async function UsageBillingPageContent({ workspaceSlug }: { workspaceSlug?: string } = {}) {
  const t = await getTranslations("usage_billing");
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });

  const inputs = await getUsageBillingInputs({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId,
    workspaceCountFallback: workspaceContext.workspaces.length,
    simulationLimit: 50,
  });
  const { usage, profile, events, agents } = inputs;

  const {
    activePlan,
    importedPackCount,
    usageRows,
    recommendedPlan,
    overIncluded,
    readinessLabel,
    primaryHeroLabel,
    showReadinessHeroPill,
  } = computeUsagePosture(inputs, workspaceContext);
  const siteUrl = getSiteUrl();
  const evidenceHref = buildWorkspacePath(workspaceContext.workspaceSlug, "/evidence");
  const packsHref = buildWorkspacePath(workspaceContext.workspaceSlug, "/packs");
  const complianceHref = buildWorkspacePath(workspaceContext.workspaceSlug, "/compliance");

  return (
    <>
      <SettingsHeader
        eyebrow={t("header.eyebrow")}
        title={t("header.title")}
        actions={
          <>
            <a className="button" href="/api/usage-billing/export">
              <Download size={16} />
              {t("header.download_json")}
            </a>
            <a className="button" href={packsHref}>
              <Boxes size={16} />
              {t("header.packs")}
            </a>
            <a className="button buttonPrimary" href={complianceHref}>
              <PackageCheck size={16} />
              {t("header.compliance_packet")}
            </a>
          </>
        }
      />

      {onboardingStatus.realEvidenceCount === 0 ? (
        <QuickStartBanner
          controlPlaneUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev"}
          status={onboardingStatus}
          surface="compliance"
          workspaceSlug={workspaceContext.workspaceSlug}
        />
      ) : null}

      <section className="adminAuthStack" aria-label={t("overview.aria_label")}>
        <section className="panel" aria-label={t("overview.panel_aria_label")}>
          <div className="rowHeader">
            <div>
              <p className="eyebrow">{t("overview.eyebrow")}</p>
              <h2>{t("overview.title")}</h2>
              <p className="meta">{t("overview.description")}</p>
            </div>
            <div className="toolbar">
              <span className={overIncluded > 0 ? "pill pillWarn" : "pill pillAllow"}>
                {primaryHeroLabel}
              </span>
              {showReadinessHeroPill ? (
                <span className="pill pillNeutral">{readinessLabel}</span>
              ) : null}
            </div>
          </div>
          <div className="usageBillingHeroStats">
            <div>
              <span className="metadata">{t("overview.current_plan")}</span>
              <strong>{activePlan.displayName}</strong>
            </div>
            <div>
              <span className="metadata">{t("overview.recommended")}</span>
              <strong>{PLAN_ENTITLEMENTS[recommendedPlan].displayName}</strong>
            </div>
            <div>
              <span className="metadata">{t("overview.governed_agents")}</span>
              <strong>{agents.length}</strong>
            </div>
            <div>
              <span className="metadata">{t("overview.evidence_retained")}</span>
              <strong>{usage.retainedAuditEventCount}</strong>
            </div>
          </div>
        </section>

        <BillingPosturePanel
          profile={profile}
          recommendedPlan={recommendedPlan}
          overIncluded={overIncluded}
          readinessLabel={readinessLabel}
          agentCount={agents.length}
          retainedEventCount={usage.retainedAuditEventCount}
          importedPackCount={importedPackCount}
          t={t}
        />

        <UsageMetersPanel usageRows={usageRows} activePlan={activePlan} t={t} />

        <ValueAnchorsPanel
          recommendedPlan={recommendedPlan}
          currentPlan={profile.planCode}
          workspaceSlug={workspaceContext.workspaceSlug}
          siteUrl={siteUrl}
          t={t}
        />

        <BillingEventLog events={events} t={t} />

        <section className="panel">
          <div className="rowHeader">
            <div>
              <p className="eyebrow">{t("proof.eyebrow")}</p>
              <h2>{t("proof.title")}</h2>
            </div>
          </div>
          <div className="commercialProofGrid">
            <a className="row commercialProof" href={evidenceHref}>
              <Database size={17} />
              <div>
                <h3>{t("proof.evidence.title")}</h3>
                <p className="meta">{t("proof.evidence.description")}</p>
              </div>
            </a>
            <a className="row commercialProof" href={packsHref}>
              <Activity size={17} />
              <div>
                <h3>{t("proof.simulation.title")}</h3>
                <p className="meta">{t("proof.simulation.description")}</p>
              </div>
            </a>
            <a className="row commercialProof" href={complianceHref}>
              <Gauge size={17} />
              <div>
                <h3>{t("proof.compliance.title")}</h3>
                <p className="meta">{t("proof.compliance.description")}</p>
              </div>
            </a>
          </div>
        </section>
      </section>
    </>
  );
}
