import { formatGovernancePath } from "@/lib/workspace";
import { EvidenceSearchInspector } from "./evidence-search-inspector";
import { EvidenceExportDialog } from "./evidence-export-dialog";
import { PageHeader } from "@spctre/ui";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { isForensicViewMode } from "@/lib/app-view-mode";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { getEvidencePageModel } from "@/lib/domains/evidence/service";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { Play } from "lucide-react";
import { QuickStartBanner } from "../quick-start-banner";
import { DegradedDataNotice } from "../degraded-data-notice";
import {
  EvidenceOverview,
  EvidenceStreamSection,
  IntentAnalysisSection,
  RuleAnalysisSection,
} from "./evidence-page-sections";
import {
  type EvidenceSearchParams,
  EVIDENCE_STATUSES as statuses,
  EVIDENCE_RUNTIME_STACKS as runtimeStacks,
  getEvidenceSearchQuery,
  firstParam,
  buildEvidenceCursorHref,
  buildRuleAnalysisHref,
  getRuleAnalysisTab,
} from "./evidence-search";
import { getTranslations } from "next-intl/server";

const EVIDENCE_PAGE_SIZE = 50;

export async function EvidencePageContent({
  workspaceSlug,
  searchParams,
}: {
  workspaceSlug?: string;
  searchParams: Promise<EvidenceSearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("evidence");
  const query = getEvidenceSearchQuery(params);
  const cursor = firstParam(params.cursor);
  const includeOnboardingSamples = firstParam(params.samples) === "1";
  const highlightId = typeof params.highlight === "string" ? params.highlight : undefined;
  const appViewMode = await getAppViewMode();
  const forensicMode = isForensicViewMode(appViewMode);
  const crossSurfaceIdentity = isFeatureEnabled("crossSurfaceAgentIdentity");
  const {
    workspaceContext,
    evidence,
    totalEvidenceCount,
    usingDb,
    degraded,
    nextCursor,
    prevCursor,
    hasNext,
    hasPrev,
    searchResult,
    activeHeatmap,
    activeUnused,
    maxDeny,
    filteredCount,
    denyCount,
    warnCount,
    allowCount,
    intentRiskPatterns,
    controlMappingIndex,
  } = await getEvidencePageModel({
    workspaceSlug,
    query,
    cursor,
    pageSize: EVIDENCE_PAGE_SIZE,
    includeOnboardingSamples,
  });
  const evidencePath = workspaceSlug ? `/${workspaceSlug}/evidence` : "/evidence";
  const searchInspectorOpen = firstParam(params.inspector) === "search";
  const cursorHref = (targetCursor: string | null) =>
    buildEvidenceCursorHref(evidencePath, params, targetCursor);
  const ruleAnalysisTab = getRuleAnalysisTab(params);
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });
  const showOnboarding =
    totalEvidenceCount === 0 ||
    onboardingStatus.realEvidenceCount === 0 ||
    onboardingStatus.quickStartEvidenceCount > 0;
  const controlPlaneUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev";

  return (
    <>
      <PageHeader
        eyebrow={formatGovernancePath(workspaceContext, t("header.eyebrow_context"))}
        title={t("header.title")}
        actions={
          <>
            <a className="button" href={`/${workspaceContext.workspaceSlug}/simulate`}>
              <Play size={16} />
              {t("header.policy_replay")}
            </a>
            <EvidenceExportDialog />
            {onboardingStatus?.quickStartEvidenceCount > 0 ? (
              <a
                className="button"
                href={includeOnboardingSamples ? evidencePath : `${evidencePath}?samples=1`}
              >
                {includeOnboardingSamples ? "Hide onboarding samples" : "Show onboarding samples"}
              </a>
            ) : null}
            <EvidenceSearchInspector
              actionPath={evidencePath}
              defaultOpen={searchInspectorOpen}
              forensicMode={forensicMode}
              runtimeStacks={[...runtimeStacks]}
              searchResult={searchResult}
              statuses={[...statuses]}
              crossSurfaceIdentity={crossSurfaceIdentity}
            />
          </>
        }
      />
      {degraded ? <DegradedDataNotice /> : null}

      <EvidenceOverview
        evidenceCount={totalEvidenceCount}
        filteredCount={filteredCount}
        denyCount={denyCount}
        warnCount={warnCount}
        allowCount={allowCount}
        shownCount={evidence.length}
        usingDb={usingDb}
      />

      {showOnboarding ? (
        <QuickStartBanner
          controlPlaneUrl={controlPlaneUrl}
          status={onboardingStatus}
          surface="evidence"
          workspaceSlug={workspaceContext.workspaceSlug}
        />
      ) : null}

      <EvidenceStreamSection
        model={{
          activeHeatmap,
          activeUnused,
          allowCount,
          denyCount,
          evidence,
          filteredCount,
          maxDeny,
          nextCursor,
          prevCursor,
          hasNext,
          hasPrev,
          totalEvidenceCount,
          usingDb,
          warnCount,
          controlMappingIndex,
        }}
        cursorHref={cursorHref}
        viewMode={appViewMode}
        highlightId={highlightId}
        workspaceSlug={workspaceContext.workspaceSlug}
      />

      <RuleAnalysisSection
        activeHeatmap={activeHeatmap}
        activeUnused={activeUnused}
        activeTab={ruleAnalysisTab}
        frictionHref={buildRuleAnalysisHref(evidencePath, params, "friction")}
        maxDeny={maxDeny}
        unusedHref={buildRuleAnalysisHref(evidencePath, params, "unused")}
        viewMode={appViewMode}
      />

      <IntentAnalysisSection intentRiskPatterns={intentRiskPatterns} />
    </>
  );
}
