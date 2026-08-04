"use client";

import type { PolicyRuleDiff } from "@spctre/policy-schema";

import { SlideOutPanel } from "@/app/slide-out-panel";
import { diffPillClass } from "@/lib/constants";

interface Props {
  diff: PolicyRuleDiff;
}

type DiffRule = NonNullable<PolicyRuleDiff["after"]>;

function RuleSnapshot({ label, rule }: { label: string; rule: DiffRule }) {
  return (
    <div>
      <span className="meta">{label}</span>
      <p>{rule.title}</p>
      <p className="meta">
        Effect: <strong>{rule.effect}</strong>
      </p>
      {rule.actions?.length ? <p className="meta">Actions: {rule.actions.join(", ")}</p> : null}
      {rule.connectors?.length ? (
        <p className="meta">Connectors: {rule.connectors.join(", ")}</p>
      ) : null}
      {rule.domains?.length ? <p className="meta">Domains: {rule.domains.join(", ")}</p> : null}
    </div>
  );
}

function RuleDetailSection({ diff, currentRule }: { diff: PolicyRuleDiff; currentRule: DiffRule }) {
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Rule detail</p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Stable rule ID</span>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>{diff.stableRuleId}</code>
        </div>
        <div>
          <span className="meta">Effect</span>
          <strong>{currentRule.effect}</strong>
        </div>
        {currentRule.connectors?.length ? (
          <div>
            <span className="meta">Connectors</span>
            <strong>{currentRule.connectors.join(", ")}</strong>
          </div>
        ) : null}
        {currentRule.actions?.length ? (
          <div>
            <span className="meta">Actions</span>
            <strong>{currentRule.actions.join(", ")}</strong>
          </div>
        ) : null}
        {currentRule.domains?.length ? (
          <div>
            <span className="meta">Domains</span>
            <strong>{currentRule.domains.join(", ")}</strong>
          </div>
        ) : null}
        {currentRule.sourcePath ? (
          <div>
            <span className="meta">Source path</span>
            <code style={{ fontSize: 12 }}>{currentRule.sourcePath}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DiffRuleInspector({ diff }: Props) {
  const currentRule = diff.after ?? diff.before;
  if (!currentRule) return null;

  const statusClass = diffPillClass[diff.status] ?? "pill";

  return (
    <SlideOutPanel
      eyebrow={`Rule diff · ${diff.status}`}
      title={currentRule.title}
      description={diff.stableRuleId}
      width="wide"
      trigger={({ open, triggerId }) => (
        <article className="row diffRow">
          <button
            aria-label={`Inspect diff for ${diff.stableRuleId}`}
            className="rowButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <div className="rowHeader">
              <div>
                <h3>{currentRule.title}</h3>
                <p className="meta">
                  <code>{diff.stableRuleId}</code>
                </p>
              </div>
              <span className={statusClass}>{diff.status}</span>
            </div>
            {diff.changedFields?.includes("effect") && diff.before && diff.after ? (
              <span
                className="pill pillWarn"
                style={{ display: "inline-flex", alignSelf: "flex-start", marginTop: 4 }}
              >
                Effect changed: {diff.before.effect} → {diff.after.effect}
              </span>
            ) : null}
            {diff.changedFields?.length ? (
              <p className="meta">Changed: {diff.changedFields.join(", ")}</p>
            ) : null}
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">Status</span>
          <span className={statusClass}>{diff.status}</span>
        </div>
        <div>
          <span className="meta">Effect</span>
          <strong>{currentRule.effect}</strong>
        </div>
      </div>

      {diff.status === "MODIFIED" && diff.before && diff.after ? (
        <div className="packRuleDetail">
          <p className="eyebrow">Before / After</p>
          <div className="beforeAfter">
            <RuleSnapshot label="Before" rule={diff.before} />
            <RuleSnapshot label="After" rule={diff.after} />
          </div>
          {diff.changedFields?.length ? (
            <p className="meta">Changed fields: {diff.changedFields.join(", ")}</p>
          ) : null}
        </div>
      ) : (
        <RuleDetailSection diff={diff} currentRule={currentRule} />
      )}
    </SlideOutPanel>
  );
}
