"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronUp, ChevronDown as ChevronDownIcon } from "lucide-react";
import { Drawer } from "@spctre/ui";
import type { PolicyRuleSummary } from "@spctre/policy-schema";

type SortKey = "title" | "effect" | "connectors" | "actions" | "sourceFormat";
type SortDir = "asc" | "desc";

interface RulesTableProps {
  rules: PolicyRuleSummary[];
}

function SortIndicator({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronDownIcon size={12} className="rulesSortIcon rulesSortIconMuted" />;
  return sortDir === "asc"
    ? <ChevronUp size={12} className="rulesSortIcon rulesSortIconActive" />
    : <ChevronDownIcon size={12} className="rulesSortIcon rulesSortIconActive" />;
}

export function RulesTable({ rules }: RulesTableProps) {
  const t = useTranslations("rules");
  const [selected, setSelected] = useState<PolicyRuleSummary | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }

  const sorted = [...rules].sort((a, b) => {
    let av = "";
    let bv = "";
    if (sortKey === "title") { av = a.title ?? ""; bv = b.title ?? ""; }
    else if (sortKey === "effect") { av = a.effect ?? ""; bv = b.effect ?? ""; }
    else if (sortKey === "connectors") { av = (a.connectors ?? []).join(","); bv = (b.connectors ?? []).join(","); }
    else if (sortKey === "actions") { av = (a.actions ?? []).join(","); bv = (b.actions ?? []).join(","); }
    else if (sortKey === "sourceFormat") { av = a.sourceFormat ?? ""; bv = b.sourceFormat ?? ""; }
    const cmp = av.localeCompare(bv);
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <>
      <div className="auditTableWrapper rulesTableWrapper">
        <table className="auditTable rulesCatalogTable">
          <thead>
            <tr>
              <th className="rulesSortableHeader" onClick={() => handleSort("title")} aria-sort={sortKey === "title" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <span>
                  {t("table.rule_title")} <SortIndicator col="title" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="rulesSortableHeader" onClick={() => handleSort("effect")} aria-sort={sortKey === "effect" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <span>
                  {t("table.effect")} <SortIndicator col="effect" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="rulesSortableHeader" onClick={() => handleSort("connectors")} aria-sort={sortKey === "connectors" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <span>
                  {t("table.connector")} <SortIndicator col="connectors" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="rulesSortableHeader" onClick={() => handleSort("actions")} aria-sort={sortKey === "actions" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <span>
                  {t("table.actions")} <SortIndicator col="actions" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="rulesSortableHeader" onClick={() => handleSort("sourceFormat")} aria-sort={sortKey === "sourceFormat" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <span>
                  {t("table.source")} <SortIndicator col="sourceFormat" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th><span className="srOnly">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((rule) => (
              <tr
                key={rule.stableRuleId}
                className="auditRow"
              >
                <td>
                  <strong>{rule.title}</strong>
                  {rule.immutable ? (
                    <span className="pill ruleInlinePill">
                      {t("table.immutable")}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span className={rule.effect === "DENY" ? "pill pillBlock" : "pill pillWarn"}>
                    {rule.effect}
                  </span>
                </td>
                <td>
                  <span className="meta">{rule.connectors?.join(", ") || t("table.none")}</span>
                </td>
                <td>
                  <span className="meta">{rule.actions?.join(", ") || t("table.none")}</span>
                </td>
                <td>
                  <code className="tinyCode">{rule.sourceFormat}</code>
                </td>
                <td><button className="button buttonSmall" type="button" onClick={() => setSelected(rule)}>Inspect</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <RuleInspectorPanel rule={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

interface PanelProps {
  rule: PolicyRuleSummary;
  onClose: () => void;
}

function RuleCodeListSection({ title, values }: { title: string; values: string[] | undefined }) {
  if (!values?.length) return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">{title}</p>
      <div className="packRuleMeta">
        {values.map((value) => (
          <div key={value}>
            <code className="smallCode">{value}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function SemanticChecksSection({ rule }: { rule: PolicyRuleSummary }) {
  const t = useTranslations("rules");
  if (!rule.semanticChecks?.length) return null;
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">{t("panel.semantic_title")}</p>
      <div className="packRuleMeta" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rule.semanticChecks.map((check) => (
          <div key={check.id} className="ruleConditionBlock" style={{ padding: "8px 12px" }}>
            <div style={{ fontWeight: 600, fontSize: "12px", marginBottom: 2 }}>{check.id}</div>
            <div className="meta" style={{ color: "var(--foreground)" }}>{check.prompt}</div>
            {check.effect ? (
              <span className="pill" style={{ marginTop: 4, display: "inline-block" }}>
                {t("panel.override_effect")} {check.effect}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleInspectorPanel({ rule, onClose }: PanelProps) {
  const t = useTranslations("rules");
  const hasConditions = rule.conditions && rule.conditions.length > 0;

  return (
    <Drawer open onClose={onClose} closeLabel={t("panel.close")} width="wide" eyebrow={t("panel.managed_rule")} title={rule.title} description={rule.stableRuleId}>
          <div className="packDrawerSummary">
            <div>
              <span className="meta">{t("panel.effect")}</span>
              <span className={rule.effect === "DENY" ? "pill pillBlock" : "pill pillWarn"}>
                {rule.effect}
              </span>
            </div>
            <div>
              <span className="meta">{t("panel.source_format")}</span>
              <strong>{rule.sourceFormat}</strong>
            </div>
            <div>
              <span className="meta">{t("panel.immutable")}</span>
              <strong>{rule.immutable ? t("panel.yes") : t("panel.no")}</strong>
            </div>
            {rule.priority != null ? (
              <div>
                <span className="meta">{t("panel.priority")}</span>
                <strong>{rule.priority}</strong>
              </div>
            ) : null}
          </div>

          <RuleCodeListSection title={t("panel.connectors")} values={rule.connectors} />

          <RuleCodeListSection title={t("panel.actions")} values={rule.actions} />

          <RuleCodeListSection title={t("panel.domains")} values={rule.domains} />

          {rule.sourcePath ? (
            <div className="packRuleDetail">
              <p className="eyebrow">{t("panel.source_path")}</p>
              <div className="packRuleMeta">
                <div>
                  <code className="breakCode">{rule.sourcePath}</code>
                </div>
              </div>
            </div>
          ) : null}

          {hasConditions ? (
            <div className="packRuleDetail">
              <p className="eyebrow">{t("panel.conditions")}</p>
              <div className="packRuleMeta">
                <div className="ruleConditionBlock">
                  <pre>
                    {JSON.stringify(rule.conditions, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}

          <SemanticChecksSection rule={rule} />
    </Drawer>
  );
}
