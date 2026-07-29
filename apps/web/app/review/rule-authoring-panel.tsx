"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, FilePlus2, Lock, Loader, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Drawer } from "@spctre/ui";
import type { PolicyRuleSummary, PolicyParameterConstraint, PolicyPackParameterDefinition, EvaluationResult } from "@spctre/policy-schema";
import type { AuthoringVocabularyEntry } from "@/lib/domains/packs/service";
import type { DraftSimulationSummary } from "@/lib/domains/review/draft-simulation";
import { assessRuleEnforcement, enforcementPillClass, type RuleEnforcementAssessment, type EnforcementCoverage } from "@/lib/policy/rule-enforcement";
import { commitRuleRevision, createDraftRuleRevision, evaluateExampleDecision, simulateDraftDecision } from "./rule-actions";
import type { CommitRevisionState, DraftRevisionState, ExampleDecisionState, DraftSimulationState } from "./rule-actions";
import { formatArtifactHash, formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

interface RuleAuthoringPanelProps {
  branchId: string;
  parentRevisionId: string;
  rules: PolicyRuleSummary[];
  viewMode: AppViewMode;
  vocabulary?: AuthoringVocabularyEntry[];
  coverage?: EnforcementCoverage;
}

// Typed suggestions for the rule being edited, scoped to its selected
// connectors. Connector/action suggestions stay broad until a connector is
// selected; constraint helpers require a recognized connector. All fields
// remain free-text; these only power datalist typeahead.
interface ScopedVocabulary {
  connectors: string[];
  actions: string[];
  domains: string[];
  constraintFields: string[];
  parameters: PolicyPackParameterDefinition[];
}

export function scopeVocabulary(vocabulary: AuthoringVocabularyEntry[], connectorsText: string): ScopedVocabulary {
  const selected = new Set(splitCsv(connectorsText).map((c) => c.toLowerCase()));
  const matched = selected.size
    ? vocabulary.filter((entry) => selected.has(entry.connector.toLowerCase()))
    : [];
  const scope = matched.length ? matched : vocabulary;
  const constraintScope = matched.length ? matched : [];
  const dedupe = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort();
  const parametersByKey = new Map<string, PolicyPackParameterDefinition>();
  for (const parameter of constraintScope.flatMap((entry) => entry.parameters)) {
    if (!parametersByKey.has(parameter.key)) parametersByKey.set(parameter.key, parameter);
  }
  return {
    connectors: dedupe(vocabulary.map((entry) => entry.connector)),
    actions: dedupe(scope.flatMap((entry) => entry.actions)),
    domains: dedupe(scope.flatMap((entry) => entry.domains)),
    constraintFields: dedupe(constraintScope.flatMap((entry) => entry.constraintFields)),
    parameters: Array.from(parametersByKey.values()),
  };
}

function DatalistOptions({ id, options }: { id: string; options: string[] }) {
  if (options.length === 0) return null;
  return (
    <datalist id={id}>
      {options.map((option) => (
        <option key={option} value={option} />
      ))}
    </datalist>
  );
}

type RuleEffect = "ALLOW" | "DENY" | "WARN" | "ESCALATE";
type ConstraintOperator = PolicyParameterConstraint["operator"];

const CONSTRAINT_OPERATORS: { value: ConstraintOperator; label: string }[] = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ at most" },
  { value: "eq", label: "= equals" },
  { value: "neq", label: "≠ not equal" },
  { value: "in", label: "in (list)" },
  { value: "not_in", label: "not in (list)" },
  { value: "contains", label: "contains" },
];

interface EditableConstraint {
  field: string;
  operator: ConstraintOperator;
  valueText: string;
  effect: "" | RuleEffect;
  parameterKey: string;
}

interface EditableRule {
  stableRuleId: string;
  title: string;
  effect: RuleEffect;
  domainsText: string;
  connectorsText: string;
  actionsText: string;
  immutable: boolean;
  inheritedImmutable: boolean;
  semanticChecksText: string;
  controlMappingsText: string;
  parameterConstraints: EditableConstraint[];
  originalSemanticChecks?: { id: string; prompt: string; effect?: RuleEffect }[];
  // Full source rule, retained so unmodeled fields (priority, conditions,
  // AGT-native fields, ...) survive a round-trip through the editor.
  original?: PolicyRuleSummary;
}

const BLANK_RULE: EditableRule = {
  stableRuleId: "",
  title: "",
  effect: "WARN",
  domainsText: "",
  connectorsText: "",
  actionsText: "",
  immutable: false,
  inheritedImmutable: false,
  semanticChecksText: "",
  controlMappingsText: "",
  parameterConstraints: []
};

function constraintValueToText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function constraintValueFromText(text: string, operator: ConstraintOperator): unknown {
  const trimmed = text.trim();
  if (operator === "in" || operator === "not_in") {
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (part !== "" && !Number.isNaN(Number(part)) ? Number(part) : part));
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function toEditableConstraints(constraints?: PolicyParameterConstraint[]): EditableConstraint[] {
  return (constraints ?? []).map((constraint) => ({
    field: constraint.field,
    operator: constraint.operator,
    valueText: constraintValueToText(constraint.value),
    effect: (constraint.effect as RuleEffect | undefined) ?? "",
    parameterKey: constraint.parameterKey ?? "",
  }));
}

export function serializeConstraints(constraints: EditableConstraint[]): PolicyParameterConstraint[] {
  return constraints
    .filter((constraint) => constraint.field.trim())
    .map((constraint) => {
      const serialized: PolicyParameterConstraint = {
        field: constraint.field.trim(),
        operator: constraint.operator,
        value: constraintValueFromText(constraint.valueText, constraint.operator),
      };
      if (constraint.parameterKey.trim()) serialized.parameterKey = constraint.parameterKey.trim();
      if (constraint.effect) serialized.effect = constraint.effect;
      return serialized;
    });
}

export function parseSemanticChecksText(
  text: string,
  stableRuleId: string,
  originalSemanticChecks?: { id: string; prompt: string; effect?: "ALLOW" | "DENY" | "WARN" | "ESCALATE" }[]
) {
  const originalChecks = originalSemanticChecks ?? [];
  const usedOriginalIds = new Set<string>();

  const lines = text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  return lines.map((line, i) => {
    let prompt = line;
    let effect: string | undefined;
    const arrowIndex = line.lastIndexOf("->");
    if (arrowIndex !== -1) {
      const possibleEffect = line.substring(arrowIndex + 2).trim().toUpperCase();
      if (possibleEffect === "WARN" || possibleEffect === "DENY" || possibleEffect === "ALLOW" || possibleEffect === "ESCALATE") {
        prompt = line.substring(0, arrowIndex).trim();
        effect = possibleEffect;
      }
    }

    let matchedObj = originalChecks.find(
      (oc) => oc.prompt === prompt && oc.effect === effect && !usedOriginalIds.has(oc.id)
    );

    if (!matchedObj) {
      matchedObj = originalChecks.find(
        (oc) => oc.prompt === prompt && !usedOriginalIds.has(oc.id)
      );
    }

    if (!matchedObj && originalChecks[i] && !usedOriginalIds.has(originalChecks[i].id)) {
      matchedObj = originalChecks[i];
    }

    let id = "";
    if (matchedObj) {
      id = matchedObj.id;
      usedOriginalIds.add(id);
    } else {
      let counter = i + 1;
      let proposedId = `${stableRuleId.trim()}-sc-${counter}`;
      while (originalChecks.some((oc) => oc.id === proposedId) || usedOriginalIds.has(proposedId)) {
        counter++;
        proposedId = `${stableRuleId.trim()}-sc-${counter}`;
      }
      id = proposedId;
      usedOriginalIds.add(id);
    }

    return {
      id,
      prompt,
      effect: effect as "ALLOW" | "DENY" | "WARN" | "ESCALATE" | undefined,
    };
  });
}

// Serialize one editable rule back to the commit payload shape. Spreads the
// original source rule first so unmodeled fields (priority, conditions, AGT-
// native, ...) round-trip; inherited-immutable rules keep their typed
// constraints/mappings verbatim so value re-coercion can't trip the server's
// immutability guard.
function serializeRuleForCommit(rule: EditableRule) {
  const semanticChecks = parseSemanticChecksText(
    rule.semanticChecksText,
    rule.stableRuleId,
    rule.originalSemanticChecks
  );
  const parameterConstraints = rule.inheritedImmutable
    ? rule.original?.parameterConstraints
    : serializeConstraints(rule.parameterConstraints);
  const controlMappings = rule.inheritedImmutable
    ? rule.original?.controlMappings
    : parseControlMappingsText(rule.controlMappingsText);
  return {
    ...rule.original,
    stableRuleId: rule.stableRuleId.trim(),
    title: rule.title.trim(),
    effect: rule.effect,
    domains: splitCsv(rule.domainsText),
    connectors: splitCsv(rule.connectorsText),
    actions: splitCsv(rule.actionsText),
    immutable: rule.immutable,
    semanticChecks: semanticChecks.length > 0 ? semanticChecks : undefined,
    controlMappings,
    parameterConstraints,
  };
}

export function toEditableRule(rule: PolicyRuleSummary): EditableRule {
  const checksText = (rule.semanticChecks ?? [])
    .map((check) => check.effect ? `${check.prompt} -> ${check.effect}` : check.prompt)
    .join("\n");
  const controlMappingsText = (rule.controlMappings ?? []).map((mapping) => `${mapping.framework}:${mapping.controlId}${mapping.rationale ? ` | ${mapping.rationale}` : ""}`).join("\n");
  return {
    stableRuleId: rule.stableRuleId,
    title: rule.title,
    effect: rule.effect,
    domainsText: (rule.domains ?? []).join(", "),
    connectorsText: (rule.connectors ?? []).join(", "),
    actionsText: (rule.actions ?? []).join(", "),
    immutable: rule.immutable,
    inheritedImmutable: rule.immutable,
    semanticChecksText: checksText,
    controlMappingsText,
    parameterConstraints: toEditableConstraints(rule.parameterConstraints),
    originalSemanticChecks: rule.semanticChecks ? rule.semanticChecks.map(sc => ({
      id: sc.id,
      prompt: sc.prompt,
      effect: sc.effect as RuleEffect | undefined
    })) : undefined,
    original: rule,
  };
}

function parseControlMappingsText(text: string) {
  const frameworks = new Set(["SOC2", "HIPAA", "ISO_27001", "ISO_42001", "EU_AI_ACT", "NIST_AI_RMF", "OWASP_AGENTIC"]);
  return text.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const [reference, rationale] = line.split("|", 2).map((part) => part.trim());
    const separator = reference.indexOf(":");
    const framework = separator >= 0 ? reference.slice(0, separator).trim() : "";
    const controlId = separator >= 0 ? reference.slice(separator + 1).trim() : "";
    return frameworks.has(framework) && controlId ? [{ framework: framework as "SOC2" | "HIPAA" | "ISO_27001" | "ISO_42001" | "EU_AI_ACT" | "NIST_AI_RMF" | "OWASP_AGENTIC", controlId, rationale: rationale || undefined }] : [];
  });
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function effectPillClass(effect: string) {
  if (effect === "DENY") return "pill pillBlock";
  if (effect === "WARN" || effect === "ESCALATE") return "pill pillWarn";
  return "pill pillAllow";
}

function assessEditableRule(rule: EditableRule, coverage?: EnforcementCoverage): RuleEnforcementAssessment {
  return assessRuleEnforcement(
    {
      effect: rule.effect,
      connectors: splitCsv(rule.connectorsText),
      semanticChecks: rule.semanticChecksText.trim()
        ? [{ id: "preview", prompt: rule.semanticChecksText.trim() }]
        : undefined,
    },
    coverage
  );
}

function DraftRulesTable({
  draftRules,
  onEdit,
  coverage,
}: {
  draftRules: EditableRule[];
  onEdit: (index: number) => void;
  coverage?: EnforcementCoverage;
}) {
  if (draftRules.length === 0) {
    return (
      <div className="emptyState">
        <h3>No rules in this revision</h3>
        <p className="meta">Add a rule to start building the policy.</p>
      </div>
    );
  }

  return (
    <div className="auditTableWrapper">
      <table className="auditTable">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Effect</th>
            <th>Enforcement</th>
            <th>Connectors</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {draftRules.map((rule, index) => (
            <tr
              key={`${rule.stableRuleId || "new"}-${index}`}
              className="auditRow"
              onClick={() => onEdit(index)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onEdit(index);
                } else if (e.key === " ") {
                  e.preventDefault();
                  onEdit(index);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Edit rule ${rule.title || rule.stableRuleId || "untitled"}`}
            >
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <strong>{rule.title || <em style={{ color: "var(--muted)" }}>Untitled</em>}</strong>
                  {rule.inheritedImmutable ? (
                    <span title="Org baseline — locked">
                      <Lock size={12} style={{ color: "var(--muted)", flexShrink: 0 }} />
                    </span>
                  ) : null}
                </div>
                <span className="meta" style={{ display: "block", marginTop: 2 }}>
                  {rule.stableRuleId || "—"}
                </span>
                {rule.inheritedImmutable ? (
                  <span className="pill pillNeutral" style={{ marginTop: 4, fontSize: 10 }}>ORG BASELINE — LOCKED</span>
                ) : rule.immutable ? (
                  <span className="pill" style={{ marginTop: 4 }}>IMMUTABLE</span>
                ) : null}
              </td>
              <td>
                <span className={effectPillClass(rule.effect)}>{rule.effect}</span>
              </td>
              <td>
                {(() => {
                  const assessment = assessEditableRule(rule, coverage);
                  return (
                    <span className={enforcementPillClass(assessment.disposition)} title={assessment.detail}>
                      {assessment.label}
                    </span>
                  );
                })()}
              </td>
              <td>
                <span className="meta">{rule.connectorsText || "—"}</span>
              </td>
              <td>
                <span className="meta">{rule.actionsText || "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthoringStatusMessages({
  draftState,
  state,
  parentRevisionId,
  viewMode,
}: {
  draftState: DraftRevisionState;
  state: CommitRevisionState;
  parentRevisionId: string;
  viewMode: AppViewMode;
}) {
  return (
    <>
      {draftState?.error ? <div className="importError">{draftState.error}</div> : null}
      {state?.error ? <div className="importError">{state.error}</div> : null}
      {draftState?.revisionId ? (
        <div className="revisionRollbackSuccess">
          Draft <code>{formatProvenanceId(draftState.revisionId, viewMode, 12, hashToFingerprint)}</code> created from{" "}
          <code>{formatProvenanceId(parentRevisionId, viewMode, 12, hashToFingerprint)}</code>
        </div>
      ) : null}
      {state?.revisionId ? (
        <div className="revisionRollbackSuccess">
          Saved revision <code>{formatProvenanceId(state.revisionId, viewMode, 12, hashToFingerprint)}</code> — hash{" "}
          <code>{formatArtifactHash(state.sourceHash, viewMode, hashToFingerprint)}</code>
        </div>
      ) : null}
    </>
  );
}

export function RuleAuthoringPanel({ branchId, parentRevisionId, rules, viewMode, vocabulary = [], coverage }: RuleAuthoringPanelProps) {
  const router = useRouter();
  const baselineRules = useMemo(() => rules.map(toEditableRule), [rules]);
  const [draftRules, setDraftRules] = useState<EditableRule[]>(baselineRules);
  const [showDraftTest, setShowDraftTest] = useState(false);
  // null = closed, -1 = new rule, >=0 = editing index
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [draftState, createDraftAction, draftPending] = useActionState<DraftRevisionState, FormData>(
    createDraftRuleRevision,
    null
  );
  const [state, action, isPending] = useActionState<CommitRevisionState, FormData>(
    commitRuleRevision,
    null
  );

  useEffect(() => {
    setDraftRules(baselineRules);
  }, [baselineRules, parentRevisionId]);

  useEffect(() => {
    if (state?.revisionId) router.refresh();
  }, [router, state?.revisionId]);

  useEffect(() => {
    if (draftState?.revisionId) router.refresh();
  }, [router, draftState?.revisionId]);

  const payload = useMemo(
    () => JSON.stringify(draftRules.map(serializeRuleForCommit)),
    [draftRules]
  );

  const applyEdit = (updated: EditableRule) => {
    if (editingIndex === -1) {
      setDraftRules((current) => [...current, updated]);
    } else if (editingIndex !== null && editingIndex >= 0) {
      setDraftRules((current) =>
        current.map((rule, i) => (i === editingIndex ? updated : rule))
      );
    }
    setEditingIndex(null);
  };

  const removeAtIndex = (index: number) => {
    setDraftRules((current) => {
      const target = current[index];
      if (!target || target.inheritedImmutable) return current;
      return current.filter((_, i) => i !== index);
    });
    setEditingIndex(null);
  };

  return (
    <>
    <section className="panel reviewPanel ruleAuthoringPanel" id="authoring">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">In-app rule authoring</p>
          <h2>
            Edit active revision rules
            <span className="headCount">{draftRules.length}</span>
          </h2>
          <p className="meta">
            Drafting from <code>{formatProvenanceId(parentRevisionId, viewMode, 12, hashToFingerprint)}</code>
          </p>
        </div>
        <div className="ruleAuthoringActions">
          <button
            className="button"
            type="button"
            aria-controls="draft-test"
            aria-expanded={showDraftTest}
            onClick={() => setShowDraftTest((visible) => !visible)}
          >
            <Play size={15} />
            {showDraftTest ? "Hide test" : "Test this draft"}
          </button>
          <button className="button buttonPrimary" type="button" onClick={() => setEditingIndex(-1)}>
            <Plus size={15} />
            Add rule
          </button>
        </div>
      </div>

      {showDraftTest ? (
        <ExampleDecisionTester rulesPayload={payload} vocabulary={vocabulary} draftRules={draftRules} coverage={coverage} />
      ) : null}

      <form action={createDraftAction} className="ruleAuthoringDraftAction">
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="baseRevisionId" value={parentRevisionId} />
        <input type="hidden" name="message" value={`Draft from ${parentRevisionId.slice(0, 8)}`} />
        <button className="button" type="submit" disabled={draftPending}>
          {draftPending ? <Loader size={15} className="spin" /> : <FilePlus2 size={15} />}
          {draftPending ? "Creating draft..." : "Create persisted draft revision"}
        </button>
      </form>

      <form action={action} className="ruleAuthoringCommit">
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="parentRevisionId" value={parentRevisionId} />
        <input type="hidden" name="rulesPayload" value={payload} />
        <input
          className="input"
          name="message"
          defaultValue="Commit via in-app rule editor"
          placeholder="Commit message"
          required
          style={{ flex: 1, minWidth: 180 }}
        />
        <input
          className="input"
          name="sourcePath"
          defaultValue="ui/review-rule-editor"
          placeholder="Source path"
          style={{ width: 190 }}
        />
        <button
          className="button"
          type="button"
          onClick={() => setDraftRules(baselineRules)}
          title="Reset all unsaved changes"
        >
          <RotateCcw size={15} />
        </button>
        <button className="button buttonPrimary" type="submit" disabled={isPending}>
          {isPending ? <Loader size={15} className="spin" /> : <Save size={15} />}
          {isPending ? "Committing..." : "Commit revision"}
        </button>
      </form>

      <AuthoringStatusMessages
        draftState={draftState}
        state={state}
        parentRevisionId={parentRevisionId}
        viewMode={viewMode}
      />

      <DraftRulesTable draftRules={draftRules} onEdit={setEditingIndex} coverage={coverage} />

      <button
        className="button"
        type="button"
        onClick={() => setEditingIndex(-1)}
        style={{ alignSelf: "flex-start" }}
      >
        <Plus size={15} />
        Add another rule
      </button>

      {editingIndex !== null ? (
        <RuleEditPanel
          rule={editingIndex === -1 ? { ...BLANK_RULE } : { ...draftRules[editingIndex]! }}
          isNew={editingIndex === -1}
          vocabulary={vocabulary}
          onApply={applyEdit}
          onRemove={
            editingIndex >= 0 && !draftRules[editingIndex]?.inheritedImmutable
              ? () => removeAtIndex(editingIndex)
              : undefined
          }
          onClose={() => setEditingIndex(null)}
        />
      ) : null}
    </section>
    <DraftSimulationSection rulesPayload={payload} />
    </>
  );
}

function DraftSimulationSection({ rulesPayload }: { rulesPayload: string }) {
  const [state, formAction, pending] = useActionState<DraftSimulationState, FormData>(
    simulateDraftDecision,
    null
  );

  return (
    <section className="panel reviewPanel draftSimulation" id="simulate-evidence">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Blast radius</p>
          <h2>Simulate against recent evidence</h2>
          <p className="meta">
            Replays your draft rules over the most recent retained decisions and reports what would change —
            before you commit. Read-only; nothing is written.
          </p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="rulesPayload" value={rulesPayload} />
          <button className="button buttonPrimary" type="submit" disabled={pending}>
            {pending ? <Loader size={15} className="spin" /> : <Activity size={15} />}
            {pending ? "Simulating..." : "Run simulation"}
          </button>
        </form>
      </div>

      {state?.error ? <div className="importError">{state.error}</div> : null}
      {state?.summary ? <DraftSimulationResult summary={state.summary} /> : null}
    </section>
  );
}

function DraftSimulationResult({ summary }: { summary: DraftSimulationSummary }) {
  if (summary.sampled === 0) {
    return (
      <div className="emptyState">
        <h3>No retained evidence yet</h3>
        <p className="meta">Once agents send governed decisions, simulate the draft against them here.</p>
      </div>
    );
  }

  return (
    <div className="exampleResult">
      <div className="simulationStats">
        <div className="simulationStat">
          <span className="simulationStatValue">{summary.sampled}</span>
          <span className="meta">decisions sampled</span>
        </div>
        <div className="simulationStat">
          <span className="simulationStatValue">{summary.changed}</span>
          <span className="meta">would change</span>
        </div>
        <div className="simulationStat">
          <span className="simulationStatValue">{summary.unchanged}</span>
          <span className="meta">unchanged</span>
        </div>
        {summary.indeterminate > 0 ? (
          <div className="simulationStat">
            <span className="simulationStatValue">{summary.indeterminate}</span>
            <span className="meta" title="Outcome depends on a domain-scoped rule; the request's domain is not recorded in evidence.">
              indeterminate
            </span>
          </div>
        ) : null}
      </div>

      {summary.indeterminate > 0 ? (
        <p className="meta" style={{ color: "var(--muted)" }}>
          {summary.indeterminate} decision{summary.indeterminate === 1 ? "" : "s"} depend on a domain-scoped rule and can&apos;t be
          resolved — evidence doesn&apos;t record the request&apos;s domain, so they&apos;re neither counted as changed nor unchanged.
        </p>
      ) : null}

      {summary.transitions.length > 0 ? (
        <div className="simulationTransitions">
          {summary.transitions.map((transition) => (
            <span key={transition.transition} className="pill pillNeutral">
              {transition.transition} <strong>×{transition.count}</strong>
            </span>
          ))}
        </div>
      ) : (
        <p className="meta">No decisions would change under the draft rules.</p>
      )}

      {summary.findings.length > 0 ? (
        <div className="auditTableWrapper">
          <table className="auditTable">
            <thead>
              <tr>
                <th>Connector / action</th>
                <th>Was</th>
                <th>Would be</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {summary.findings.map((finding) => (
                <tr key={finding.decisionId}>
                  <td>
                    <strong>{finding.connector}</strong>
                    <span className="meta" style={{ display: "block", marginTop: 2 }}>{finding.action}</span>
                  </td>
                  <td>
                    <span className={effectPillClass(finding.previousStatus)}>{finding.previousStatus}</span>
                  </td>
                  <td>
                    <span className={effectPillClass(finding.proposedStatus)}>{finding.proposedStatus}</span>
                  </td>
                  <td>
                    <span className="meta">{finding.reason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ExampleDecisionTester({
  rulesPayload,
  vocabulary,
  draftRules,
  coverage,
}: {
  rulesPayload: string;
  vocabulary: AuthoringVocabularyEntry[];
  draftRules: EditableRule[];
  coverage?: EnforcementCoverage;
}) {
  const [connector, setConnector] = useState("");
  const [action, setAction] = useState("");
  const [domainsText, setDomainsText] = useState("");
  const [intent, setIntent] = useState("");
  const [paramsText, setParamsText] = useState("");
  const [state, formAction, pending] = useActionState<ExampleDecisionState, FormData>(
    evaluateExampleDecision,
    null
  );
  const scoped = useMemo(() => scopeVocabulary(vocabulary, connector), [vocabulary, connector]);
  const assessmentByRule = useMemo(
    () => new Map(draftRules.map((rule) => [rule.stableRuleId.trim(), assessEditableRule(rule, coverage)])),
    [draftRules, coverage]
  );

  return (
    <section className="ruleAuthoringTester" id="draft-test" aria-labelledby="draft-test-title">
      <div className="ruleAuthoringTesterHeading">
        <div>
          <p className="eyebrow">Preview draft</p>
          <h3 id="draft-test-title">Test this draft</h3>
          <p className="meta">
            Runs the working draft through the same evaluator the gateway uses. Deterministic — only the
            connector, action, and parameters you provide.
          </p>
        </div>
      </div>

      <form action={formAction} className="exampleTesterForm">
        <input type="hidden" name="rulesPayload" value={rulesPayload} />
        <DatalistOptions id="example-connectors" options={scoped.connectors} />
        <DatalistOptions id="example-actions" options={scoped.actions} />
        <DatalistOptions id="example-domains" options={scoped.domains} />
        <div className="exampleTesterGrid">
          <div>
            <label className="meta">Connector</label>
            <input
              className="input"
              name="connector"
              list="example-connectors"
              value={connector}
              onChange={(e) => setConnector(e.target.value)}
              placeholder="e.g. stripe"
            />
          </div>
          <div>
            <label className="meta">Action</label>
            <input
              className="input"
              name="action"
              list="example-actions"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. refund.create"
            />
          </div>
          <div>
            <label className="meta">Domains (optional, comma separated)</label>
            <input
              className="input"
              name="domains"
              list="example-domains"
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              placeholder="e.g. refunds"
            />
          </div>
          <div>
            <label className="meta">Agent intent (optional, for semantic checks)</label>
            <input
              className="input"
              name="toolIntent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="e.g. issue a large customer refund"
            />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label className="meta">Tool parameters (optional JSON object)</label>
            <textarea
              className="input"
              name="toolParameters"
              style={{ height: 72, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              placeholder={'{ "amount_cents": 60000 }'}
            />
          </div>
        </div>
        <button className="button buttonPrimary" type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>
          {pending ? <Loader size={15} className="spin" /> : <Play size={15} />}
          {pending ? "Evaluating..." : "Run test"}
        </button>
      </form>

      {state?.error ? <div className="importError">{state.error}</div> : null}
      {state?.result ? (
        <ExampleDecisionResult result={state.result} assessmentByRule={assessmentByRule} />
      ) : null}
    </section>
  );
}

function ExampleDecisionResult({
  result,
  assessmentByRule,
}: {
  result: EvaluationResult;
  assessmentByRule: Map<string, RuleEnforcementAssessment>;
}) {
  const matchedSteps = result.trace.filter((step) => step.matched);

  return (
    <div className="exampleResult">
      <div className="exampleResultHead">
        <span className={`${effectPillClass(result.status)} pillLarge`}>{result.status}</span>
        <p className="meta">{result.reason}</p>
      </div>
      {matchedSteps.length > 0 ? (
        <div className="auditTableWrapper">
          <table className="auditTable">
            <thead>
              <tr>
                <th>Matching rule</th>
                <th>Effect</th>
                <th>Enforcement</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {matchedSteps.map((step) => {
                const assessment = assessmentByRule.get(step.stableRuleId);
                return (
                  <tr key={step.stableRuleId}>
                    <td>
                      <strong>{step.title || step.stableRuleId}</strong>
                      <span className="meta" style={{ display: "block", marginTop: 2 }}>{step.stableRuleId}</span>
                    </td>
                    <td>
                      <span className={effectPillClass(step.effect)}>{step.effect}</span>
                    </td>
                    <td>
                      {assessment ? (
                        <span className={enforcementPillClass(assessment.disposition)} title={assessment.detail}>
                          {assessment.label}
                        </span>
                      ) : (
                        <span className="meta">—</span>
                      )}
                    </td>
                    <td>
                      <span className="meta">{step.matchReason}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

interface RuleEditPanelProps {
  rule: EditableRule;
  isNew: boolean;
  vocabulary: AuthoringVocabularyEntry[];
  onApply: (updated: EditableRule) => void;
  onRemove?: () => void;
  onClose: () => void;
}

function RuleEditFields({
  draft,
  update,
  vocabulary,
}: {
  draft: EditableRule;
  update: (patch: Partial<EditableRule>) => void;
  vocabulary: AuthoringVocabularyEntry[];
}) {
  const scoped = useMemo(() => scopeVocabulary(vocabulary, draft.connectorsText), [vocabulary, draft.connectorsText]);
  return (
    <>
      <DatalistOptions id="authoring-connectors" options={scoped.connectors} />
      <DatalistOptions id="authoring-domains" options={scoped.domains} />
      <DatalistOptions id="authoring-actions" options={scoped.actions} />
      <section className="ruleEditSection" aria-labelledby="rule-details-heading">
        <div className="ruleEditSectionHeading">
          <div>
            <p className="eyebrow">1. Identify</p>
            <h3 id="rule-details-heading">Name the rule</h3>
          </div>
          <p className="meta">Give this policy a stable reference and a title your team will recognize.</p>
        </div>
        <div className="ruleEditGrid">
          <div>
            <label className="meta">Stable rule ID</label>
            <input className="input" type="text" value={draft.stableRuleId} onChange={(e) => update({ stableRuleId: e.target.value })} disabled={draft.inheritedImmutable} placeholder="e.g. deny-pii-export" />
          </div>
          <div>
            <label className="meta">Title</label>
            <input className="input" type="text" value={draft.title} onChange={(e) => update({ title: e.target.value })} disabled={draft.inheritedImmutable} placeholder="Human-readable title" />
          </div>
        </div>
      </section>

      <section className="ruleEditSection" aria-labelledby="rule-scope-heading">
        <div className="ruleEditSectionHeading">
          <div>
            <p className="eyebrow">2. Scope</p>
            <h3 id="rule-scope-heading">Choose where it applies</h3>
          </div>
          <p className="meta">Type a connector or action, or choose a suggestion. Other values are allowed. Separate multiple values with commas.</p>
        </div>
        <div className="ruleEditGrid">
          <div>
            <label className="meta">Connectors</label>
            <input className="input" type="text" list="authoring-connectors" value={draft.connectorsText} onChange={(e) => update({ connectorsText: e.target.value })} disabled={draft.inheritedImmutable} placeholder="e.g. stripe, github" />
          </div>
          <div>
            <label className="meta">Actions</label>
            <input className="input" type="text" list="authoring-actions" value={draft.actionsText} onChange={(e) => update({ actionsText: e.target.value })} disabled={draft.inheritedImmutable} placeholder="e.g. refund.create" />
          </div>
          <div>
            <label className="meta">Domains (optional)</label>
            <input className="input" type="text" list="authoring-domains" value={draft.domainsText} onChange={(e) => update({ domainsText: e.target.value })} disabled={draft.inheritedImmutable} placeholder="e.g. finance, hr" />
          </div>
        </div>
      </section>

      <section className="ruleEditSection" aria-labelledby="rule-enforcement-heading">
        <div className="ruleEditSectionHeading">
          <div>
            <p className="eyebrow">3. Enforce</p>
            <h3 id="rule-enforcement-heading">Set the decision</h3>
          </div>
          <p className="meta">Add a deterministic condition when the rule should only apply at a specific threshold.</p>
        </div>
        <div className="ruleEditGrid ruleEffectField">
          <div>
            <label className="meta">Effect</label>
            <select className="input" value={draft.effect} onChange={(e) => update({ effect: e.target.value as EditableRule["effect"] })} disabled={draft.inheritedImmutable}>
              <option value="ALLOW">ALLOW — permit the action</option>
              <option value="WARN">WARN — permit and record a warning</option>
              <option value="ESCALATE">ESCALATE — require review</option>
              <option value="DENY">DENY — block the action</option>
            </select>
          </div>
        </div>
        <ConstraintEditor
          constraints={draft.parameterConstraints}
          disabled={draft.inheritedImmutable}
          fieldSuggestions={scoped.constraintFields}
          parameters={scoped.parameters}
          onChange={(parameterConstraints) => update({ parameterConstraints })}
        />
      </section>

      <details className="ruleEditAdvanced">
        <summary>
          <span>Advanced conditions and governance</span>
          <span className="meta">Semantic checks, control mappings, and immutability</span>
        </summary>
        <div className="ruleEditAdvancedBody">
          <div>
            <label className="meta">Semantic prompts / natural language checks (one per line)</label>
            <textarea className="input" style={{ height: 100, resize: "vertical", fontFamily: "var(--font-sans)" }} value={draft.semanticChecksText} onChange={(e) => update({ semanticChecksText: e.target.value })} disabled={draft.inheritedImmutable} placeholder="e.g. check for unprofessional behavior&#10;e.g. check for destructive commands" />
          </div>
          <div>
            <label className="meta">Control mappings (one per line: FRAMEWORK:CONTROL_ID | rationale)</label>
            <textarea className="input" style={{ height: 76, resize: "vertical", fontFamily: "var(--font-sans)" }} value={draft.controlMappingsText} onChange={(e) => update({ controlMappingsText: e.target.value })} disabled={draft.inheritedImmutable} placeholder="SOC2:CC6.1 | Access control for governed tool use" />
          </div>
          <label className="meta ruleCheckbox">
            <input type="checkbox" checked={draft.immutable} onChange={(e) => update({ immutable: e.target.checked })} disabled={draft.inheritedImmutable} />
            Mark as immutable
          </label>
        </div>
      </details>
    </>
  );
}

function ConstraintEditor({
  constraints,
  disabled,
  fieldSuggestions,
  parameters,
  onChange,
}: {
  constraints: EditableConstraint[];
  disabled: boolean;
  fieldSuggestions: string[];
  parameters: PolicyPackParameterDefinition[];
  onChange: (constraints: EditableConstraint[]) => void;
}) {
  const parameterKeys = parameters.map((parameter) => parameter.key);
  const updateAt = (index: number, patch: Partial<EditableConstraint>) => {
    onChange(constraints.map((constraint, i) => (i === index ? { ...constraint, ...patch } : constraint)));
  };
  const removeAt = (index: number) => {
    onChange(constraints.filter((_, i) => i !== index));
  };
  const add = () => {
    onChange([...constraints, { field: "", operator: "gte", valueText: "", effect: "", parameterKey: "" }]);
  };

  const listOperator = (op: ConstraintOperator) => op === "in" || op === "not_in";

  return (
    <div className="constraintEditor">
      <label className="meta">
        Parameter constraints — deterministic checks evaluated at decision time
      </label>
      <DatalistOptions id="constraint-fields" options={fieldSuggestions} />
      <DatalistOptions id="constraint-param-keys" options={parameterKeys} />
      {constraints.length === 0 ? (
        <p className="meta" style={{ color: "var(--muted)", margin: "4px 0 8px" }}>
          No parameter constraints. Add one to gate on a typed tool-call parameter (e.g.{" "}
          <code>amount_cents ≥ 50000 → ESCALATE</code>).
        </p>
      ) : (
        <div className="constraintRows">
          {constraints.map((constraint, index) => (
            <div className="constraintRow" key={index}>
              <input
                className="input"
                type="text"
                list="constraint-fields"
                value={constraint.field}
                onChange={(e) => updateAt(index, { field: e.target.value })}
                disabled={disabled}
                placeholder="field (e.g. amount_cents)"
                aria-label="Constraint field"
              />
              <select
                className="input"
                value={constraint.operator}
                onChange={(e) => updateAt(index, { operator: e.target.value as ConstraintOperator })}
                disabled={disabled}
                aria-label="Constraint operator"
              >
                {CONSTRAINT_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <input
                className="input"
                type="text"
                value={constraint.valueText}
                onChange={(e) => updateAt(index, { valueText: e.target.value })}
                disabled={disabled}
                placeholder={listOperator(constraint.operator) ? "comma,separated,values" : "value"}
                aria-label="Constraint value"
              />
              <select
                className="input"
                value={constraint.effect}
                onChange={(e) => updateAt(index, { effect: e.target.value as EditableConstraint["effect"] })}
                disabled={disabled}
                aria-label="Constraint effect override"
                title="Effect applied when this constraint matches (defaults to the rule effect)"
              >
                <option value="">Rule effect</option>
                <option value="ALLOW">ALLOW</option>
                <option value="WARN">WARN</option>
                <option value="ESCALATE">ESCALATE</option>
                <option value="DENY">DENY</option>
              </select>
              <input
                className="input"
                type="text"
                list="constraint-param-keys"
                value={constraint.parameterKey}
                onChange={(e) => updateAt(index, { parameterKey: e.target.value })}
                disabled={disabled}
                placeholder="Pack setting (optional)"
                aria-label="Pack setting (optional)"
                title="Optional workspace-overridable pack setting bound to this constraint's value"
              />
              {!disabled ? (
                <button
                  className="iconButton"
                  type="button"
                  onClick={() => removeAt(index)}
                  aria-label="Remove constraint"
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {constraints.length > 0 && parameters.length > 0 ? (
        <details className="constraintKnobHelp">
          <summary className="meta">Available pack settings</summary>
          <p className="meta">
            Use one of these in the optional pack-setting field above:{" "}
            {parameters.map((parameter, index) => (
              <span key={parameter.key}>
                {index > 0 ? ", " : ""}
                <code>{parameter.key}</code>
                {parameter.default !== undefined ? ` (default ${String(parameter.default)})` : ""}
              </span>
            ))}
          </p>
        </details>
      ) : null}
      {!disabled ? (
        <button className="button" type="button" onClick={add} style={{ alignSelf: "flex-start", marginTop: 6 }}>
          <Plus size={15} />
          Add constraint
        </button>
      ) : null}
    </div>
  );
}

// Raw-policy escape hatch: pretty-print the exact commit payload (including
// unmodeled/AGT-native fields the form does not surface) for policy-as-code
// editing, and parse it back losslessly.
export function rawJsonForRule(rule: EditableRule): string {
  return JSON.stringify(serializeRuleForCommit(rule), null, 2);
}

const RULE_EFFECTS: RuleEffect[] = ["ALLOW", "WARN", "ESCALATE", "DENY"];

export function editableRuleFromRawJson(text: string, base: EditableRule): { rule: EditableRule } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Rule JSON is not valid." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Rule JSON must be a single object." };
  }
  const row = parsed as Record<string, unknown>;
  try {
    const editable = toEditableRule(parsed as PolicyRuleSummary);
    return {
      rule: {
        ...editable,
        // Coerce the required fields so a hand-edited payload can never crash
        // the form; the server still validates on commit.
        stableRuleId: typeof row.stableRuleId === "string" ? row.stableRuleId : "",
        title: typeof row.title === "string" ? row.title : "",
        effect: RULE_EFFECTS.includes(row.effect as RuleEffect) ? (row.effect as RuleEffect) : "WARN",
        inheritedImmutable: base.inheritedImmutable,
      },
    };
  } catch {
    return { error: "Could not read the rule fields from JSON." };
  }
}

function RuleEditModeToggle({
  mode,
  onForm,
  onRaw,
}: {
  mode: "form" | "raw";
  onForm: () => void;
  onRaw: () => void;
}) {
  return (
    <div className="ruleEditModeToggle" role="tablist" aria-label="Editor mode">
      <button className={`button${mode === "form" ? " buttonPrimary" : ""}`} type="button" role="tab" aria-selected={mode === "form"} onClick={onForm}>
        Form
      </button>
      <button className={`button${mode === "raw" ? " buttonPrimary" : ""}`} type="button" role="tab" aria-selected={mode === "raw"} onClick={onRaw}>
        Raw JSON
      </button>
    </div>
  );
}

function RawRuleEditor({
  rawText,
  onChange,
  rawError,
  disabled,
}: {
  rawText: string;
  onChange: (value: string) => void;
  rawError: string | null;
  disabled: boolean;
}) {
  return (
    <div className="rawRuleEditor">
      <label className="meta">
        Raw rule JSON — edits every field, including ones the form does not surface (priority, conditions,
        AGT-native). Lossless round-trip.
      </label>
      <textarea
        className="input"
        style={{ height: 420, resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
        value={rawText}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        aria-label="Raw rule JSON"
      />
      {rawError ? <div className="importError">{rawError}</div> : null}
    </div>
  );
}

function RuleEditFormBody({
  draft,
  update,
  vocabulary,
}: {
  draft: EditableRule;
  update: (patch: Partial<EditableRule>) => void;
  vocabulary: AuthoringVocabularyEntry[];
}) {
  return (
    <>
      <RuleEditFields draft={draft} update={update} vocabulary={vocabulary} />

      {draft.inheritedImmutable ? (
        <p className="meta" style={{ color: "var(--muted)" }}>
          This rule was inherited as immutable and cannot be edited or removed.
        </p>
      ) : null}
    </>
  );
}

function RuleEditPanel({ rule: initialRule, isNew, vocabulary, onApply, onRemove, onClose }: RuleEditPanelProps) {
  const [draft, setDraft] = useState<EditableRule>(initialRule);
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  const update = (patch: Partial<EditableRule>) => setDraft((prev) => ({ ...prev, ...patch }));

  const enterRawMode = () => {
    setRawText(rawJsonForRule(draft));
    setRawError(null);
    setMode("raw");
  };

  // Parse the raw editor back into the draft. Returns the updated rule on
  // success, or null (and surfaces an error) on failure.
  const commitRawToDraft = (): EditableRule | null => {
    const result = editableRuleFromRawJson(rawText, draft);
    if ("error" in result) {
      setRawError(result.error);
      return null;
    }
    setRawError(null);
    setDraft(result.rule);
    return result.rule;
  };

  const switchToForm = () => {
    if (commitRawToDraft()) setMode("form");
  };

  const handleApply = () => {
    if (mode === "raw") {
      const updated = commitRawToDraft();
      if (updated) onApply(updated);
      return;
    }
    onApply(draft);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="wide"
      eyebrow={isNew ? "New rule" : "Edit rule"}
      title={draft.title || <span style={{ color: "var(--muted)" }}>Untitled rule</span>}
      description={isNew ? undefined : draft.stableRuleId}
      headerActions={<RuleEditModeToggle mode={mode} onForm={switchToForm} onRaw={enterRawMode} />}
    >
          {mode === "raw" ? (
            <RawRuleEditor
              rawText={rawText}
              onChange={setRawText}
              rawError={rawError}
              disabled={draft.inheritedImmutable}
            />
          ) : (
            <RuleEditFormBody draft={draft} update={update} vocabulary={vocabulary} />
          )}

          <div className="ruleEditFooter">
            <div>
              {onRemove ? (
                <button className="button buttonPillDanger" type="button" onClick={onRemove}>
                  Remove rule
                </button>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="button buttonPrimary"
                type="button"
                onClick={handleApply}
                disabled={draft.inheritedImmutable}
              >
                {isNew ? "Add rule" : "Apply changes"}
              </button>
            </div>
          </div>
    </Drawer>
  );
}
