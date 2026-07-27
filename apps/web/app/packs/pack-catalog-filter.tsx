"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { comparePackVersions, getPackCatalogTier, getPackVersion, type PolicyPack } from "@spctre/policy-schema/packs";
import { PackSlideOut } from "./pack-slideout";
import type { AppViewMode } from "@/lib/app-view-mode";

interface PackCatalogFilterProps {
  packs: PolicyPack[];
  installedByConnector: Record<
    string,
    {
      branchId: string;
      revisionId: string;
      installedVersion: string;
      installedAt: string;
      hasCustomizations: boolean;
    }
  >;
  upgradeSummaryByConnector: Record<
    string,
    {
      addedFromUpstream: number;
      removedFromUpstream: number;
      modifiedFromUpstream: number;
      localOnlyRules: number;
    }
  >;
  workspaceId: string;
  workspaceSlug: string;
  viewMode: AppViewMode;
  immediatePublishAllowed: boolean;
  catalogStatusLoaded: boolean;
}

const QUICK_FILTER_ROWS = 2;
const QUICK_FILTERS_PER_ROW = 8;
const MAX_QUICK_FILTER_CHIPS = QUICK_FILTER_ROWS * QUICK_FILTERS_PER_ROW;


// Search + tag filtering state and the derived quick-filter chip ranking.
function usePackFiltering(packs: PolicyPack[]) {
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const availableTags = useMemo(
    () => Array.from(new Set(packs.flatMap((pack) => pack.tags))),
    [packs]
  );
  const normalizedQuery = query.trim().toLowerCase();

  const packSearchableTextMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const pack of packs) {
      const text = [
        pack.name,
        pack.connector,
        pack.description,
        ...pack.tags,
        ...pack.domains,
        ...pack.rules.flatMap((rule) => [
          rule.stableRuleId,
          rule.title,
          rule.effect,
          ...rule.domains,
          ...rule.connectors,
          ...rule.actions,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      map.set(pack.id, text);
    }
    return map;
  }, [packs]);

  const packMatchesQuery = useMemo(() => {
    return (packId: string, q: string) => {
      if (!q) return true;
      const text = packSearchableTextMap.get(packId);
      return text ? text.includes(q) : false;
    };
  }, [packSearchableTextMap]);

  const filteredPacks = useMemo(() => {
    return packs.filter((pack) => {
      const matchesTags =
        selectedTags.length === 0 || selectedTags.every((tag) => pack.tags.includes(tag));
      return matchesTags && packMatchesQuery(pack.id, normalizedQuery);
    }).sort((left, right) => {
      const tierOrder = Number(getPackCatalogTier(right) === "canonical") - Number(getPackCatalogTier(left) === "canonical");
      return tierOrder !== 0 ? tierOrder : left.name.localeCompare(right.name);
    });
  }, [packs, normalizedQuery, selectedTags, packMatchesQuery]);

  const quickTagMatchCounts = useMemo(() => {
    return new Map(
      availableTags.map((tag) => {
        const tagsWithChipApplied = selectedTags.includes(tag)
          ? selectedTags
          : [...selectedTags, tag];

        const nextMatchCount = packs.filter((pack) => {
          const matchesTags =
            tagsWithChipApplied.length === 0 ||
            tagsWithChipApplied.every((selectedTag) => pack.tags.includes(selectedTag));
          return matchesTags && packMatchesQuery(pack.id, normalizedQuery);
        }).length;

        return [tag, nextMatchCount] as const;
      })
    );
  }, [availableTags, packs, normalizedQuery, selectedTags, packMatchesQuery]);

  const quickTagSortCounts = useMemo(() => {
    return new Map(
      availableTags.map((tag) => {
        const count = packs.filter(
          (pack) => pack.tags.includes(tag) && packMatchesQuery(pack.id, normalizedQuery)
        ).length;
        return [tag, count] as const;
      })
    );
  }, [availableTags, packs, normalizedQuery, packMatchesQuery]);

  const quickTags = useMemo(() => {
    const rankedTags = [...availableTags].sort((tagA, tagB) => {
      const countDiff = (quickTagSortCounts.get(tagB) ?? 0) - (quickTagSortCounts.get(tagA) ?? 0);
      return countDiff !== 0 ? countDiff : tagA.localeCompare(tagB);
    });

    const selectedTagSet = new Set(selectedTags);
    const selectedVisibleTags = rankedTags.filter((tag) => selectedTagSet.has(tag));
    const remainingSlots = Math.max(MAX_QUICK_FILTER_CHIPS - selectedVisibleTags.length, 0);
    const nonSelectedVisibleTags = rankedTags
      .filter((tag) => !selectedTagSet.has(tag))
      .slice(0, remainingSlots);

    return [...selectedVisibleTags, ...nonSelectedVisibleTags].sort((tagA, tagB) => {
      const countDiff = (quickTagSortCounts.get(tagB) ?? 0) - (quickTagSortCounts.get(tagA) ?? 0);
      return countDiff !== 0 ? countDiff : tagA.localeCompare(tagB);
    });
  }, [availableTags, quickTagSortCounts, selectedTags]);

  const clearFilters = () => {
    setQuery("");
    setSelectedTags([]);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((activeTag) => activeTag !== tag) : [...current, tag]
    );
  };

  const hasFilters = Boolean(normalizedQuery) || selectedTags.length > 0;

  return { query, setQuery, selectedTags, filteredPacks, quickTags, quickTagMatchCounts, clearFilters, toggleTag, hasFilters };
}

export function PackCatalogFilter({
  packs,
  installedByConnector,
  upgradeSummaryByConnector,
  workspaceId,
  workspaceSlug,
  viewMode,
  immediatePublishAllowed,
  catalogStatusLoaded,
}: PackCatalogFilterProps) {
  const t = useTranslations("packs");
  const { query, setQuery, selectedTags, filteredPacks, quickTags, quickTagMatchCounts, clearFilters, toggleTag, hasFilters } =
    usePackFiltering(packs);

  return (
    <>
      <div className="packSearchBar" role="search" aria-label={t("filters.search_aria_label")}>
        <label className="packSearchField" htmlFor="pack-search">
          <span>{t("filters.find_label")}</span>
          <span className="packSearchInputWrap">
            <Search size={16} aria-hidden="true" />
            <input
              id="pack-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("filters.placeholder")}
            />
          </span>
        </label>

        <div className="packSearchMeta" aria-live="polite">
          <strong>{filteredPacks.length}</strong>
          <span>{t("filters.count", { filtered: filteredPacks.length, total: packs.length })}</span>
        </div>

        {hasFilters ? (
          <button className="button" type="button" onClick={clearFilters}>
            <X size={14} />
            {t("filters.reset")}
          </button>
        ) : null}
      </div>

      <div className="packQuickFilters" aria-label={t("filters.quick_filters_aria_label")}>
        {quickTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          const nextMatchCount = quickTagMatchCounts.get(tag) ?? 0;
          return (
            <button
              key={tag}
              type="button"
              className={isSelected ? "packFilterChip packFilterChipActive" : "packFilterChip"}
              aria-pressed={isSelected}
              onClick={() => toggleTag(tag)}
            >
              {tag} ({nextMatchCount})
            </button>
          );
        })}
      </div>

      {filteredPacks.length > 0 ? (
        <div className="packCatalogSections">
          {(["canonical", "compatible"] as const).map((tier) => {
            const tierPacks = filteredPacks.filter((pack) => getPackCatalogTier(pack) === tier);
            if (tierPacks.length === 0) return null;

            const header = (
              <div>
                <p className="eyebrow">{t(`tiers.${tier}.eyebrow`)}</p>
                <h3 id={`pack-tier-${tier}`}>{t(`tiers.${tier}.title`)}</h3>
                <p className="meta">{t(`tiers.${tier}.description`)}</p>
              </div>
            );
            const packGrid = (
              <div className="packGrid">
                {tierPacks.map((pack) => {
                  const installed = installedByConnector[pack.connector];
                  const latestVersion = getPackVersion(pack);
                  const isOutdated =
                    Boolean(installed) &&
                    comparePackVersions(installed.installedVersion, latestVersion) < 0;

                  return (
                    <PackSlideOut
                      installed={installed}
                      isOutdated={isOutdated}
                      upgradeSummary={upgradeSummaryByConnector[pack.connector]}
                      key={pack.id}
                      pack={pack}
                      workspaceId={workspaceId}
                      workspaceSlug={workspaceSlug}
                      viewMode={viewMode}
                      immediatePublishAllowed={immediatePublishAllowed}
                      catalogStatusLoaded={catalogStatusLoaded}
                    />
                  );
                })}
              </div>
            );

            if (tier === "compatible") {
              return (
                <details className="packCatalogSection packCatalogSectionCompatible" key={tier} open={hasFilters || undefined}>
                  <summary aria-labelledby={`pack-tier-${tier}`}>
                    {header}
                    <span className="packCompatibleCount">{tierPacks.length}</span>
                  </summary>
                  {packGrid}
                </details>
              );
            }

            return (
              <section className="packCatalogSection" key={tier} aria-labelledby={`pack-tier-${tier}`}>
                <div className="rowHeader">{header}</div>
                {packGrid}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="packEmptyState">
          <strong>{t("filters.empty_title")}</strong>
          <p className="meta">{t("filters.empty_description")}</p>
        </div>
      )}
    </>
  );
}
