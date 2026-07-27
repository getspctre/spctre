import {
  CANONICAL_PACK_CONNECTORS,
  comparePackVersions,
  getPackVersion,
  POLICY_PACKS,
} from "@spctre/policy-schema";

import { getWorkspaceContext } from "@/lib/workspace";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { PackCatalogFilter } from "./pack-catalog-filter";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { getPacksCatalogModel, type PackUpgradeSummary } from "@/lib/domains/packs/service";
import { workspaceAllowsImmediatePackPublish } from "@/lib/repositories/approval-workflow/config";
import { getTranslations } from "next-intl/server";

export async function PacksPageContent({ workspaceSlug }: { workspaceSlug?: string } = {}) {
  const t = await getTranslations("packs");
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const appViewMode = await getAppViewMode();
  let installedByConnector: Record<string, { branchId: string; revisionId: string; installedVersion: string; installedAt: string; hasCustomizations: boolean }> = {};
  let upgradeSummaryByConnector: Record<string, PackUpgradeSummary> = {};
  let immediatePublishAllowed = false;
  let catalogStatusLoaded = false;
  try {
    const [model, publishAllowed] = await Promise.all([
      getPacksCatalogModel({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
      }),
      workspaceAllowsImmediatePackPublish({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
      }),
    ]);
    installedByConnector = model.installedByConnector;
    upgradeSummaryByConnector = model.upgradeSummaryByConnector;
    immediatePublishAllowed = publishAllowed;
    catalogStatusLoaded = true;
  } catch {
    /* DB not available — show all packs as installable */
  }
  const installedCount = Object.keys(installedByConnector).length;
  const outdatedCount = POLICY_PACKS.filter((pack) => {
    const status = installedByConnector[pack.connector];
    if (!status) return false;
    return comparePackVersions(status.installedVersion, getPackVersion(pack)) < 0;
  }).length;
  const highRiskCount = POLICY_PACKS.filter((pack) => pack.riskLevel === "HIGH" && installedByConnector[pack.connector]).length;

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspaceContext)}</p>
          <h1>{t("title")}</h1>
        </div>
      </section>

      <section className="packsHero" aria-label={t("hero.aria_label")}>
        <div className="packsHeroMain">
          <p className="eyebrow">{t("hero.eyebrow")}</p>
          <h2>{t("hero.title")}</h2>
          <p className="meta">
            {t("hero.description")}
          </p>
        </div>
        <div className="packsHeroStats">
          <div>
            <span className="meta">{t("hero.stats.maintained")}</span>
            <strong>{CANONICAL_PACK_CONNECTORS.length}</strong>
          </div>
          <div>
            <span className="meta">{t("hero.stats.installed")}</span>
            <strong>{installedCount}</strong>
          </div>
          <div>
            <span className="meta">{t("hero.stats.high_risk")}</span>
            <strong>{highRiskCount}</strong>
          </div>
        </div>
      </section>

      <section className="panel packsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">{t("catalog.eyebrow")}</p>
            <h2>{t("catalog.title")}</h2>
            <p className="meta">
              {t("catalog.description")}
            </p>
          </div>
          {outdatedCount > 0 ? <span className="pill pillWarn">{t("catalog.updates", { count: outdatedCount })}</span> : null}
        </div>

        <PackCatalogFilter
          installedByConnector={installedByConnector}
          upgradeSummaryByConnector={upgradeSummaryByConnector}
          packs={POLICY_PACKS}
          workspaceId={workspaceContext.workspaceId}
          workspaceSlug={workspaceContext.workspaceSlug}
          viewMode={appViewMode}
          immediatePublishAllowed={immediatePublishAllowed}
          catalogStatusLoaded={catalogStatusLoaded}
        />
      </section>
    </>
  );
}
