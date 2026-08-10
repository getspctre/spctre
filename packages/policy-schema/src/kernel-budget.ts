// How much of the kernel's bounded request a published policy consumes.
//
// The C ABI accepts a bounded request (see PUBLISHED_EVALUATOR_CONTRACT.md), and
// a host that exceeds it fails the decision closed. Enforcement sends the whole
// composed layer set on every call, so the ceiling is reached by publishing
// policy, not by anything the caller does at request time — which means it
// should be reported while policy is authored rather than discovered as a
// refused decision in production.
//
// The limit itself is read from the kernel; restating it here would drift.

import { jsPolicyKernelLimits } from "./native";
import type { PolicyRuleSummary } from "./types";

/**
 * Bytes reserved for the per-request fields a publish cannot see: tool intent,
 * plan summary, tool parameters, connector, action, domains and the artifact
 * hash. A policy sized to the raw limit would still fail a decision carrying
 * large tool parameters, so the usable budget is deliberately smaller than the
 * ABI maximum.
 */
export const POLICY_KERNEL_RUNTIME_HEADROOM_BYTES = 64 * 1024;

export type PolicyKernelLimits = { maxRequestBytes: number; maxResponseBytes: number };

export type PolicyRequestBudget = {
  /** Serialized size of the composed layers the kernel would receive. */
  policyBytes: number;
  /** Bytes available to policy after reserving runtime headroom. */
  usableBytes: number;
  maxRequestBytes: number;
  runtimeHeadroomBytes: number;
  /** policyBytes / usableBytes, as a fraction. 1 or more does not fit. */
  utilization: number;
  fits: boolean;
};

export function policyKernelLimits(): PolicyKernelLimits {
  return JSON.parse(jsPolicyKernelLimits()) as PolicyKernelLimits;
}

/**
 * Measures the composed layers as the kernel receives them.
 *
 * Only the rule fields the request carries are counted, so this tracks the real
 * wire size rather than the shape of whatever richer record a caller holds.
 */
export function measurePolicyRequestBudget(
  layers: { scope: string; rules: PolicyRuleSummary[] }[],
): PolicyRequestBudget {
  const { maxRequestBytes } = policyKernelLimits();
  const wire = layers.map((layer) => ({
    scope: layer.scope,
    rules: layer.rules.map((rule) => ({
      stableRuleId: rule.stableRuleId,
      title: rule.title,
      effect: rule.effect,
      domains: rule.domains,
      connectors: rule.connectors,
      actions: rule.actions,
      immutable: rule.immutable,
      semanticChecks: rule.semanticChecks ?? [],
      parameterConstraints: rule.parameterConstraints ?? [],
    })),
  }));
  const policyBytes = Buffer.byteLength(JSON.stringify(wire), "utf8");
  const usableBytes = Math.max(0, maxRequestBytes - POLICY_KERNEL_RUNTIME_HEADROOM_BYTES);
  return {
    policyBytes,
    usableBytes,
    maxRequestBytes,
    runtimeHeadroomBytes: POLICY_KERNEL_RUNTIME_HEADROOM_BYTES,
    utilization: usableBytes === 0 ? Infinity : policyBytes / usableBytes,
    fits: policyBytes <= usableBytes,
  };
}

/** Human-readable summary for a publish refusal or a headroom warning. */
export function describePolicyRequestBudget(budget: PolicyRequestBudget): string {
  const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
  return (
    `composed policy is ${kib(budget.policyBytes)} of the ${kib(budget.usableBytes)} ` +
    `usable evaluation budget (${Math.round(budget.utilization * 100)}%; ` +
    `${kib(budget.maxRequestBytes)} kernel limit less ${kib(budget.runtimeHeadroomBytes)} ` +
    `reserved for per-request fields)`
  );
}
