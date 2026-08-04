"use client";

import { Activity } from "lucide-react";
import { TabsRow } from "@spctre/ui";
import type { RuleHeatEntry, UnusedRule } from "@/lib/domains/evidence/service";
import { SlideOutPanel } from "@/app/slide-out-panel";
import type { AppViewMode } from "@/lib/app-view-mode";

interface HeatmapInspectorProps {
  entry: RuleHeatEntry;
  maxDeny: number;
  viewMode: AppViewMode;
}

function HeatmapRuleInspector({ entry, maxDeny, viewMode }: HeatmapInspectorProps) {
  const total = entry.denyCount + entry.warnCount + entry.allowCount;
  const denyPct = total > 0 ? ((entry.denyCount / total) * 100).toFixed(0) : "0";

  return (
    <SlideOutPanel
      eyebrow="Evidence · High friction"
      title={entry.ruleId}
      description={`${entry.denyCount} denials · ${entry.warnCount} warnings · ${entry.allowCount} allows`}
      trigger={({ open, triggerId }) => (
        <article className="heatmapRow">
          <button
            aria-label={`Inspect rule ${entry.ruleId}`}
            className="rowButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <div className="heatmapRuleInfo">
              <code className="heatmapRuleId">{entry.ruleId}</code>
              <div className="heatmapBar">
                <div
                  className="heatmapFill"
                  style={{ width: `${(entry.denyCount / maxDeny) * 100}%` }}
                />
              </div>
            </div>
            <div className="heatmapCounts">
              {entry.denyCount > 0 && <span className="pill pillBlock">{entry.denyCount}</span>}
              {entry.warnCount > 0 && <span className="pill pillWarn">{entry.warnCount}</span>}
              {entry.allowCount > 0 && <span className="pill pillAllow">{entry.allowCount}</span>}
            </div>
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Deny</span>
          <strong>{entry.denyCount}</strong>
        </div>
        <div>
          <span className="meta">Warn</span>
          <strong>{entry.warnCount}</strong>
        </div>
        <div>
          <span className="meta">Allow</span>
          <strong>{entry.allowCount}</strong>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Evidence breakdown</p>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Rule ID</span>
            <code style={{ fontSize: 12, wordBreak: "break-all" }}>{entry.ruleId}</code>
          </div>
          <div>
            <span className="meta">Total decisions</span>
            <strong>{total}</strong>
          </div>
          <div>
            <span className="meta">Deny rate</span>
            <strong>{denyPct}%</strong>
          </div>
          <div>
            <span className="meta">Relative friction</span>
            <strong>
              {entry.total > 0 ? ((entry.denyCount / entry.total) * 100).toFixed(0) : 0}% of total
            </strong>
          </div>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Review guidance</p>
        <p className="meta">
          This rule is generating high denial volume. Consider reviewing the rule configuration to
          check whether the deny threshold matches current operational intent, or investigate
          whether agents are hitting this rule unexpectedly.
        </p>
      </div>
    </SlideOutPanel>
  );
}

interface RuleAnalysisTabsProps {
  activeHeatmap: RuleHeatEntry[];
  activeUnused: UnusedRule[];
  activeTab: "friction" | "unused";
  frictionHref: string;
  maxDeny: number;
  unusedHref: string;
  viewMode: AppViewMode;
}

export function RuleAnalysisTabs({
  activeHeatmap,
  activeUnused,
  activeTab,
  frictionHref,
  maxDeny,
  unusedHref,
  viewMode,
}: RuleAnalysisTabsProps) {
  return (
    <div>
      <TabsRow>
        <a
          aria-selected={activeTab === "friction"}
          className={activeTab === "friction" ? "uiTab uiTabActive" : "uiTab"}
          href={frictionHref}
          role="tab"
        >
          High-friction <span className="headCount">{activeHeatmap.length}</span>
        </a>
        <a
          aria-selected={activeTab === "unused"}
          className={activeTab === "unused" ? "uiTab uiTabActive" : "uiTab"}
          href={unusedHref}
          role="tab"
        >
          Unused rules <span className="headCount">{activeUnused.length}</span>
        </a>
      </TabsRow>

      {activeTab === "friction" ? (
        activeHeatmap.length === 0 ? (
          <div className="emptyState">
            <Activity size={18} className="sectionIcon" />
            <h3>No high-friction rules</h3>
            <p className="meta">
              No rules have generated significant denial volume in the retention window.
            </p>
          </div>
        ) : (
          <div className="heatmapList">
            {activeHeatmap.map((entry) => (
              <HeatmapRuleInspector
                key={entry.ruleId}
                entry={entry}
                maxDeny={maxDeny}
                viewMode={viewMode}
              />
            ))}
          </div>
        )
      ) : activeUnused.length === 0 ? (
        <div className="emptyState">
          <Activity size={18} className="sectionIcon" />
          <h3>All rules active</h3>
          <p className="meta">
            Every rule has matched at least one decision in the retention window.
          </p>
        </div>
      ) : (
        <div className="unusedList">
          {activeUnused.map((rule) => (
            <UnusedRuleInspector key={rule.stableRuleId} rule={rule} viewMode={viewMode} />
          ))}
        </div>
      )}
    </div>
  );
}

interface UnusedRuleInspectorProps {
  rule: UnusedRule;
  viewMode: AppViewMode;
}

function UnusedRuleInspector({ rule, viewMode }: UnusedRuleInspectorProps) {
  const effectClass = rule.effect === "DENY" ? "pill pillBlock" : "pill pillWarn";

  return (
    <SlideOutPanel
      eyebrow="Evidence · Unused rule"
      title={rule.title}
      description={`No evidence activity found for ${rule.stableRuleId}`}
      trigger={({ open, triggerId }) => (
        <article className="row">
          <button
            aria-label={`Inspect unused rule ${rule.stableRuleId}`}
            className="rowButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <div className="rowHeader">
              <div style={{ minWidth: 0 }}>
                <h3>{rule.title}</h3>
                <p className="meta">
                  <code style={{ overflowWrap: "anywhere" }}>{rule.stableRuleId}</code>
                  {rule.connectors.length > 0 && ` / ${rule.connectors.join(", ")}`}
                </p>
              </div>
              <span className={effectClass}>{rule.effect}</span>
            </div>
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Effect</span>
          <span className={effectClass}>{rule.effect}</span>
        </div>
        <div>
          <span className="meta">Connectors</span>
          <strong>{rule.connectors.join(", ") || "Any"}</strong>
        </div>
        <div>
          <span className="meta">Domains</span>
          <strong>{rule.domains.join(", ") || "Any"}</strong>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Rule detail</p>
        <div className="packRuleMeta">
          <div>
            <span className="meta">Stable rule ID</span>
            <code style={{ fontSize: 12, wordBreak: "break-all" }}>{rule.stableRuleId}</code>
          </div>
          <div>
            <span className="meta">Evidence</span>
            <strong>None recorded</strong>
          </div>
        </div>
      </div>

      <div className="packRuleDetail">
        <p className="eyebrow">Review guidance</p>
        <p className="meta">
          No runtime decisions have matched this rule. This may indicate the rule covers a path that
          has not yet been exercised, or that the connector and action selectors do not match any
          current agent traffic. Consider reviewing whether the rule should be narrowed, broadened,
          or removed.
        </p>
      </div>
    </SlideOutPanel>
  );
}
