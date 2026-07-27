import type { PolicyRuleSummary } from "@spctre/policy-schema";

/**
 * How a rule can actually be enforced at runtime, derived purely from its own
 * composition. This mirrors the reasoning the bundle-export layer already
 * applies (semantic checks need a runtime evaluator; WARN is advisory; blocking
 * effects with deterministic conditions enforce pre-action) but surfaces it to
 * the author while they write, so "explicit runtime effect and enforcement
 * compatibility" is visible before publish.
 *
 * Client-safe: imports only a type from @spctre/policy-schema, so it can be used
 * in both client components and server actions without pulling the package's
 * Node/native runtime into a browser bundle.
 */
export type RuleEnforcementDisposition = "DETERMINISTIC" | "SEMANTIC" | "ADVISORY" | "ALLOW" | "OBSERVE";

export interface RuleEnforcementAssessment {
  disposition: RuleEnforcementDisposition;
  label: string;
  detail: string;
  /** True when the decision needs no runtime LLM/semantic evaluator. */
  deterministic: boolean;
}

type EnforcementInput = Pick<PolicyRuleSummary, "effect"> & {
  semanticChecks?: PolicyRuleSummary["semanticChecks"];
  connectors?: PolicyRuleSummary["connectors"];
};

/**
 * Declared runtime coverage for the workspace. When adapters are declared, a
 * blocking rule whose connector no adapter covers can only be observed, not
 * enforced pre-action — regardless of how deterministic the rule itself is.
 * When no adapters are declared, coverage is unknown and the assessment stays
 * rule-intrinsic.
 */
export interface EnforcementCoverage {
  adapterCount: number;
  coveredConnectors: string[];
}

export function assessRuleEnforcement(
  rule: EnforcementInput,
  coverage?: EnforcementCoverage
): RuleEnforcementAssessment {
  const hasSemantic = (rule.semanticChecks?.length ?? 0) > 0;

  if (rule.effect === "ALLOW") {
    return {
      disposition: "ALLOW",
      label: "Allow",
      detail: "Permits the action; no enforcement is applied.",
      deterministic: !hasSemantic,
    };
  }

  if (rule.effect === "WARN") {
    return {
      disposition: "ADVISORY",
      label: "Advisory",
      detail: "Records a warning but never blocks the action.",
      deterministic: !hasSemantic,
    };
  }

  // DENY or ESCALATE — these intend to block. If runtime coverage is declared
  // and no adapter covers any of the rule's connectors, it can't be enforced
  // pre-action on a declared runtime, so it degrades to observe-only.
  if (coverage && coverage.adapterCount > 0 && (rule.connectors?.length ?? 0) > 0) {
    const covered = new Set(coverage.coveredConnectors);
    if (!rule.connectors!.some((connector) => covered.has(connector))) {
      return {
        disposition: "OBSERVE",
        label: "Observe-only",
        detail:
          "No declared runtime adapter covers this connector, so the decision is recorded as evidence but not enforced pre-action.",
        deterministic: !hasSemantic,
      };
    }
  }

  if (hasSemantic) {
    return {
      disposition: "SEMANTIC",
      label: "Semantic",
      detail:
        "Blocks only where the runtime can evaluate the semantic checks. The connector, action, and parameter conditions still enforce deterministically.",
      deterministic: false,
    };
  }

  return {
    disposition: "DETERMINISTIC",
    label: rule.effect === "ESCALATE" ? "Pre-action escalate" : "Pre-action block",
    detail: "Deterministic — enforceable as a pre-action decision on any gateway or native adapter.",
    deterministic: true,
  };
}

export function enforcementPillClass(disposition: RuleEnforcementDisposition): string {
  if (disposition === "DETERMINISTIC") return "pill pillEnforced";
  if (disposition === "SEMANTIC") return "pill pillWarn";
  if (disposition === "OBSERVE") return "pill pillBlock";
  return "pill pillNeutral";
}
