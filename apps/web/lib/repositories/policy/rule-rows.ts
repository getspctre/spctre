import type { JSONValue } from "postgres";
import type { PolicyParameterConstraint, SemanticCheck } from "@spctre/policy-schema";

/**
 * Single definition of how a policy rule is persisted to `policy_rule`.
 *
 * Nine write paths insert into this table. They previously each hand-built
 * their row object and repeated the column list inline, which meant adding a
 * column required nine correct edits — and missing one would silently persist
 * a rule with that field dropped rather than fail. Rules are what the gateway
 * enforces, so a quietly truncated rule is an enforcement gap, not a display
 * bug.
 *
 * Every mapping path now goes through {@link toPolicyRuleRows} and every
 * insert names {@link POLICY_RULE_COLUMNS}, so the shape is declared once.
 */
export interface PolicyRuleRow {
  tenant_id: string;
  workspace_id: string | null;
  branch_id: string;
  revision_id: string;
  stable_rule_id: string;
  title: string;
  effect: string;
  source_path: string | null;
  domains: string[];
  connectors: string[];
  actions: string[];
  immutable: boolean;
  /**
   * SemanticCheck[] — `[]` when the rule declares none, never null. Held as
   * jsonb because these are what the runtime evaluator matches on, and the
   * relational columns above cannot express them.
   *
   * Kept as a value, never a pre-stringified JSON string: postgres serialises
   * a JS string bound to a jsonb column as a JSON *string*, so `"[]"` would be
   * stored instead of `[]`, breaking every structural jsonb read of it.
   *
   * NULL is reserved to mean "not yet materialised" (a row written before
   * migration 007 and not yet backfilled). Writing `[]` for the empty case is
   * what makes that distinction possible: readers use NULL to decide whether
   * they must fall back to parsing source_document, and if "no matchers" also
   * stored NULL the fallback could never be retired.
   */
  semantic_checks: JSONValue;
  /** PolicyParameterConstraint[] — `[]` when none, never null. */
  parameter_constraints: JSONValue;
}

/** Column list for `INSERT INTO policy_rule`, in row order. */
export const POLICY_RULE_COLUMNS = [
  "tenant_id",
  "workspace_id",
  "branch_id",
  "revision_id",
  "stable_rule_id",
  "title",
  "effect",
  "source_path",
  "domains",
  "connectors",
  "actions",
  "immutable",
  "semantic_checks",
  "parameter_constraints",
] as const;

/**
 * Normalises to an array, including the empty case. See
 * PolicyRuleRow.semantic_checks for why "no matchers" must be `[]` and not NULL,
 * and why this must not stringify.
 */
function matchersOrEmpty(
  value: readonly (SemanticCheck | PolicyParameterConstraint)[] | undefined,
): JSONValue {
  return (value ? [...value] : []) as unknown as JSONValue;
}

/**
 * The rule fields persistence needs.
 *
 * Deliberately structural rather than `PolicyRuleSummary`: callers pass packs
 * (which omit sourceFormat), `as const` literals (whose arrays are readonly),
 * and editor output. Naming only what is persisted lets all of them through
 * without casts, and keeps this decoupled from authoring-only fields.
 */
export interface PersistableRule {
  stableRuleId: string;
  title: string;
  effect: string;
  sourcePath?: string;
  domains?: readonly string[];
  connectors?: readonly string[];
  actions?: readonly string[];
  immutable?: boolean;
  semanticChecks?: readonly SemanticCheck[];
  parameterConstraints?: readonly PolicyParameterConstraint[];
}

/**
 * Maps rules onto persistable rows. `sourcePath` is the revision-level default
 * used when a rule does not carry its own.
 */
export function toPolicyRuleRows(params: {
  tenantId: string;
  workspaceId: string | null;
  branchId: string;
  revisionId: string;
  sourcePath?: string | null;
  rules: readonly PersistableRule[];
}): PolicyRuleRow[] {
  return params.rules.map((rule) => ({
    tenant_id: params.tenantId,
    workspace_id: params.workspaceId,
    branch_id: params.branchId,
    revision_id: params.revisionId,
    stable_rule_id: rule.stableRuleId,
    title: rule.title,
    effect: rule.effect,
    source_path: rule.sourcePath ?? params.sourcePath ?? null,
    domains: [...(rule.domains ?? [])],
    connectors: [...(rule.connectors ?? [])],
    actions: [...(rule.actions ?? [])],
    immutable: rule.immutable ?? false,
    semantic_checks: matchersOrEmpty(rule.semanticChecks),
    parameter_constraints: matchersOrEmpty(rule.parameterConstraints),
  }));
}
