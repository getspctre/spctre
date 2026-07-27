import Link from "next/link";
import { Search } from "lucide-react";
import { listPolicyRules } from "@/lib/domains/policy/service";
import { getWorkspaceContext } from "@/lib/workspace";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { RulesTable } from "./rules-inspector";
import { selectDemoRulesFallback } from "./demo-rules-fallback";
import { getTranslations } from "next-intl/server";

type RulesSearchParams = Record<string, string | string[] | undefined>;

export async function RulesInventoryPageContent({
  workspaceSlug,
  searchParams,
}: {
  workspaceSlug?: string;
  searchParams: Promise<RulesSearchParams>;
}) {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const params = await searchParams;
  const searchText = typeof params.q === "string" ? params.q.trim() || undefined : undefined;
  const normalizedQuery = searchText?.toLowerCase();

  let rules = selectDemoRulesFallback(workspaceContext.tenantId, normalizedQuery);
  try {
    const dbRules = await listPolicyRules({
      workspaceId: workspaceContext.workspaceId,
      tenantId: workspaceContext.tenantId,
      searchText,
    });
    rules = dbRules;
  } catch {
    // DB not available, keep demo fallback only for the demo tenant.
  }

  const connectorCount = new Set(rules.flatMap((rule) => rule.connectors ?? []).filter(Boolean)).size;
  const immutableRuleCount = rules.filter((rule) => rule.immutable).length;
  const denyRuleCount = rules.filter((rule) => rule.effect === "DENY").length;
  const warnRuleCount = rules.filter((rule) => rule.effect === "WARN").length;
  const t = await getTranslations("rules");

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspaceContext)}</p>
          <h1>{t("title")}</h1>
        </div>
      </section>

      <section className="rulesHero" aria-label={t("hero.aria")}>
        <div className="rulesHeroMain">
          <p className="eyebrow">{t("hero.eyebrow")}</p>
          <h2>{t("hero.title")}</h2>
          <p className="meta">
            {t.rich("hero.meta", {
              review: (chunks) => (
                <a href={buildWorkspacePath(workspaceContext.workspaceSlug, "/review")}>{chunks}</a>
              ),
            })}
          </p>
          <form
            action={buildWorkspacePath(workspaceContext.workspaceSlug, "/rules")}
            className="rulesSearchForm"
          >
            <label className="rulesSearchField">
              <span className="metadata">{t("hero.search_label")}</span>
              <input
                name="q"
                defaultValue={searchText ?? ""}
                placeholder={t("hero.search_ph")}
                className="input"
              />
            </label>
            <button className="button buttonPrimary" type="submit">
              <Search size={16} />
              {t("hero.search_btn")}
            </button>
            {searchText ? (
              <Link className="button" href={buildWorkspacePath(workspaceContext.workspaceSlug, "/rules")}>
                {t("hero.reset")}
              </Link>
            ) : null}
          </form>
        </div>
        <div className="rulesHeroStats">
          <div>
            <span className="metadata">{t("hero.managed")}</span>
            <strong>{rules.length}</strong>
          </div>
          <div>
            <span className="metadata">{t("hero.connectors")}</span>
            <strong>{connectorCount}</strong>
          </div>
          <div>
            <span className="metadata">{t("hero.immutable")}</span>
            <strong>{immutableRuleCount}</strong>
          </div>
          <div>
            <span className="metadata">{t("hero.deny_warn")}</span>
            <strong>
              {denyRuleCount} / {warnRuleCount}
            </strong>
          </div>
        </div>
      </section>

      <section className="panel rulesPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">{t("inv.eyebrow")}</p>
            <h2>
              {t("inv.title")}
              <span className="headCount">{rules.length}</span>
            </h2>
            <p className="meta">
              {searchText ? t("inv.filtered", { query: searchText }) : t("inv.hint")}
            </p>
          </div>
        </div>

        {rules.length === 0 && searchText ? (
          <div className="emptyState">
            <h3>{t("inv.no_match_title")}</h3>
            <p className="meta">{t("inv.no_match_body")}</p>
          </div>
        ) : null}

        {rules.length === 0 && !searchText ? (
          <div className="emptyState">
            <h3>{t("inv.empty_title")}</h3>
            <p className="meta">{t("inv.empty_body")}</p>
          </div>
        ) : null}

        {rules.length > 0 ? <RulesTable rules={rules} /> : null}
      </section>
    </>
  );
}
