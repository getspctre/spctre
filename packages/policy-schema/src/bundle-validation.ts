// Whether a policy can be enforced at all, as decided by the kernel.
//
// The checks are implemented in the kernel because the failures they catch are
// invisible at evaluation time: an unknown constraint operator or a mistyped
// comparison value makes the constraint compare false forever, so the rule never
// matches and the policy reads as published and healthy while enforcing nothing.
// Restating these rules in TypeScript would be a second opinion on what is
// enforceable, which is the divergence this boundary exists to remove.
//
// Parsing an authored document into rules stays in TypeScript: it is an
// authoring concern with round-trip fidelity requirements of its own, and it
// does not change what a decision means.

import { jsValidatePolicyBundle } from "./native";
import type { PolicyRuleSummary } from "./types";

export type PolicyBundleValidationSeverity = "ERROR" | "WARNING";

export type PolicyBundleValidationIssue = {
  severity: PolicyBundleValidationSeverity;
  /** Stable machine-readable reason, e.g. "unknown_operator". */
  code: string;
  message: string;
  stableRuleId?: string | null;
  layerIndex?: number | null;
};

export type PolicyBundleValidation = {
  /** False when any issue is an ERROR. Warnings never block. */
  valid: boolean;
  issues: PolicyBundleValidationIssue[];
};

/** Validates one revision's rules, unlayered. */
export function validatePolicyRules(rules: PolicyRuleSummary[]): PolicyBundleValidation {
  return JSON.parse(jsValidatePolicyBundle(JSON.stringify({ rules }))) as PolicyBundleValidation;
}

/** Validates the composed layer set, including layer scope and ordering. */
export function validatePolicyBundleLayers(
  layers: { scope: string; rules: PolicyRuleSummary[] }[],
): PolicyBundleValidation {
  return JSON.parse(jsValidatePolicyBundle(JSON.stringify({ layers }))) as PolicyBundleValidation;
}

/** The blocking issues only, formatted for an operator-facing message. */
export function describeBlockingIssues(validation: PolicyBundleValidation): string {
  return validation.issues
    .filter((issue) => issue.severity === "ERROR")
    .map((issue) => issue.message)
    .join(" ");
}
