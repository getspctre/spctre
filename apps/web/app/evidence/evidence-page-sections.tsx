import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { type AppViewMode } from "@/lib/app-view-mode";
import type { EvidencePageModel } from "@/lib/domains/evidence/service";
import { EvidenceTable } from "./evidence-table";
import { RuleAnalysisTabs } from "./rule-intel-inspector";
import { useTranslations } from "next-intl";

type EvidenceModelSlice = Pick<
  EvidencePageModel,
  | "activeHeatmap"
  | "activeUnused"
  | "allowCount"
  | "controlMappingIndex"
  | "denyCount"
  | "evidence"
  | "filteredCount"
  | "maxDeny"
  | "nextCursor"
  | "prevCursor"
  | "hasNext"
  | "hasPrev"
  | "totalEvidenceCount"
  | "usingDb"
  | "warnCount"
>;

export function EvidenceOverview({
  evidenceCount,
  filteredCount,
  denyCount,
  warnCount,
  allowCount,
  shownCount,
  usingDb
}: {
  evidenceCount: number;
  filteredCount: number;
  denyCount: number;
  warnCount: number;
  allowCount: number;
  shownCount: number;
  usingDb: boolean;
}) {
  const t = useTranslations("evidence.overview");

  return (
    <section className="evidenceHero" aria-label={t("aria_label")}>
      <div className="evidenceHeroMain">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">
          {t("meta", {
            mode: usingDb ? t("live_ingest") : t("demo_ingest"),
            count: evidenceCount.toLocaleString(),
            shown: shownCount.toLocaleString(),
          })}
        </p>
      </div>
      <div className="evidenceHeroStats">
        <div>
          <span className="meta">{t("stats.total")}</span>
          <strong>{evidenceCount}</strong>
        </div>
        <div>
          <span className="meta">{t("stats.matches")}</span>
          <strong>{filteredCount}</strong>
        </div>
        <div>
          <span className="meta">{t("stats.statuses")}</span>
          <strong>{denyCount} / {warnCount} / {allowCount}</strong>
        </div>
      </div>
    </section>
  );
}

export function EvidenceStreamSection({
  model,
  cursorHref,
  viewMode,
  highlightId,
  workspaceSlug,
}: {
  model: EvidenceModelSlice;
  cursorHref: (cursor: string | null) => string;
  viewMode: AppViewMode;
  highlightId?: string;
  workspaceSlug?: string;
}) {
  const t = useTranslations("evidence.stream");
  const { evidence, nextCursor, prevCursor, hasNext, hasPrev, totalEvidenceCount, usingDb, controlMappingIndex } = model;
  const showPagination = usingDb && (hasPrev || hasNext);

  return (
    <section className="panel evidencePanel" id="evidence">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>
            {t("title")}
            <span className="headCount">{totalEvidenceCount}</span>
          </h2>
          {usingDb ? (
            <p className="meta">
              {t("showing", { shown: evidence.length.toLocaleString(), total: totalEvidenceCount.toLocaleString() })}
            </p>
          ) : null}
        </div>
        {showPagination ? (
          <div className="toolbar">
            {hasPrev ? (
              <a className="button" href={cursorHref(prevCursor)}>
                <ChevronLeft size={16} />
                {t("prev_short")}
              </a>
            ) : null}
            {hasNext ? (
              <a className="button" href={cursorHref(nextCursor)}>
                {t("next_short")}
                <ChevronRight size={16} />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {!usingDb ? (
        <div className="demoEvidenceBanner">
          <div>
            <p className="eyebrow">{t("demo.eyebrow")}</p>
            <p className="meta">
              {t("demo.description")}
            </p>
          </div>
          <div className="toolbar">
            <a className="button buttonSmall" href={workspaceSlug ? `/${workspaceSlug}` : "/"}>
              {t("demo.quick_start")}
            </a>
            <a className="button buttonSmall" href={workspaceSlug ? `/${workspaceSlug}/agents` : "/agents"}>
              {t("demo.cli_setup")}
            </a>
          </div>
        </div>
      ) : null}
      <EvidenceTable evidence={evidence} viewMode={viewMode} highlightId={highlightId} workspaceSlug={workspaceSlug} controlMappingIndex={controlMappingIndex} />
      {showPagination ? (
        <div className="paginationFooter">
          {hasPrev ? (
            <a className="button" href={cursorHref(prevCursor)}>
              <ChevronLeft size={16} />
              {t("previous_page")}
            </a>
          ) : null}
          {hasNext ? (
            <a className="button" href={cursorHref(nextCursor)}>
              {t("next_page")}
              <ChevronRight size={16} />
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function RuleAnalysisSection({
  activeHeatmap,
  activeUnused,
  activeTab,
  frictionHref,
  maxDeny,
  unusedHref,
  viewMode
}: Pick<EvidencePageModel, "activeHeatmap" | "activeUnused" | "maxDeny"> & {
  activeTab: "friction" | "unused";
  frictionHref: string;
  unusedHref: string;
  viewMode: AppViewMode;
}) {
  const t = useTranslations("evidence.rule_analysis");

  return (
    <section className="panel evidencePanel" id="intelligence">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>{t("title")}</h2>
          <p className="meta">{t("description")}</p>
        </div>
        <Flame size={20} className="sectionIcon" />
      </div>

      <RuleAnalysisTabs
        activeHeatmap={activeHeatmap}
        activeUnused={activeUnused}
        activeTab={activeTab}
        frictionHref={frictionHref}
        maxDeny={maxDeny}
        unusedHref={unusedHref}
        viewMode={viewMode}
      />
    </section>
  );
}

export function IntentAnalysisSection({
  intentRiskPatterns
}: Pick<EvidencePageModel, "intentRiskPatterns">) {
  const t = useTranslations("evidence.intent_patterns");

  if (intentRiskPatterns.length === 0) return null;

  return (
    <section className="panel evidencePanel" id="intent-patterns">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2>{t("title")}</h2>
          <p className="meta">{t("description")}</p>
        </div>
        <Flame size={20} className="sectionIcon" />
      </div>

      <div className="connectorImpactList" style={{ padding: "16px 20px" }}>
        {intentRiskPatterns.map(({ intent, count }) => {
          const pct = (count / intentRiskPatterns[0].count) * 100;
          return (
            <div className="connectorImpactRow" key={intent}>
              <span className="ruleRef" style={{ flex: 1 }}>{intent}</span>
              <div className="connectorImpactTrack" style={{ flex: 2 }}>
                <div className="connectorImpactBar" style={{ width: `${pct}%`, backgroundColor: "var(--brand-warn)" }} />
              </div>
              <span className="meta" style={{ width: 80, textAlign: "right" }}>
                {t("flags", { count })}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
