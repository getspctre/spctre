import { evaluateDecision } from "@spctre/policy-schema";
import type { GatewayDecisionResult } from "@spctre/policy-schema";
import { logger } from "@spctre/platform/logging";
import { incrementCounter } from "@spctre/platform/metrics";
import { getLatestPublishedBundle } from "@/lib/repositories/policy";
import { runWithTenantContext } from "@/lib/tenant-context";

/**
 * The single published-rule enforcement layer.
 *
 * Two evaluators exist and they answer different questions:
 *
 *   - `evaluateGatewayDecision` is a generic *safety-threshold* evaluator. It
 *     scores request-shaped risk signals (amountUsd, consequence, confidence,
 *     dataSensitivity, trustScore) and knows nothing about authored policy.
 *   - `evaluateDecision` is the *published-rule* evaluator. It matches the
 *     tenant's published, composed rules against connector/action and returns
 *     their authored effect.
 *
 * Every action-enforcement path must consult both. Running only the threshold
 * evaluator means an authored `ESCALATE brief.file` rule is recorded as
 * PROCEED — the policy is published, visible in simulate, and silently
 * unenforced. This module exists so the gateway decide route and evidence
 * ingest reach that verdict through the same code rather than each
 * reimplementing (or forgetting) it.
 */

/** A published-rule verdict that should override the threshold evaluator. */
export type PublishedPolicyVerdict = GatewayDecisionResult & { outcome: "ESCALATE" | "ABORT" };

export interface PublishedPolicyDecisionInput {
  tenantId: string;
  workspaceId: string;
  connector?: string;
  action?: string;
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
}

/**
 * Resolves the published-rule verdict for an action, or null when the rules
 * do not constrain it (no published bundle, no connector/action, or the rules
 * evaluate to ALLOW/WARN).
 *
 * Throws if the published bundle cannot be read — see
 * {@link readPublishedPolicyBundle}.
 */
export async function resolvePublishedPolicyDecision(
  input: PublishedPolicyDecisionInput,
): Promise<PublishedPolicyVerdict | null> {
  if (!input.connector || !input.action) return null;

  const published = await readPublishedPolicyBundle(input);
  if (!published) return null;

  const evaluated = evaluateDecision({
    connector: input.connector,
    action: input.action,
    rules: published.bundle.rules,
    toolIntent: input.toolIntent,
    planSummary: input.planSummary,
    toolParameters: input.toolParameters,
  });

  if (evaluated.status === "DENY")
    return {
      outcome: "ABORT",
      reason: evaluated.reason,
      riskLevel: "HIGH",
      shouldQueue: false,
      slaHours: undefined,
    };
  if (evaluated.status === "ESCALATE")
    return {
      outcome: "ESCALATE",
      reason: evaluated.reason,
      riskLevel: "HIGH",
      shouldQueue: true,
      slaHours: 4,
    };
  return null;
}

/**
 * Folds a published-rule verdict into a threshold-evaluator verdict.
 *
 * A published DENY is absolute. A published ESCALATE only upgrades a threshold
 * PROCEED — it must never downgrade an ABORT the threshold evaluator already
 * reached. ALLOW/WARN arrive here as null and leave the threshold verdict
 * alone.
 */
export function mergePublishedPolicyDecision<T extends { outcome: string }>(
  threshold: T,
  policy: (T & PublishedPolicyVerdict) | null,
): T {
  if (policy?.outcome === "ABORT") return policy;
  if (policy?.outcome === "ESCALATE" && threshold.outcome === "PROCEED") return policy;
  return threshold;
}

/**
 * Reads the published bundle for enforcement, failing closed.
 *
 * A read failure must never degrade to "no rules matched" — that would let a
 * transient database fault silently downgrade a published DENY/ESCALATE to
 * PROCEED, which is exactly the masking `swallow` exists to prevent. So this
 * does not substitute a fallback: it rethrows, and callers must let that
 * propagate so clients fail closed. The catch exists only to make the cause
 * observable, so an operator can tell an unreadable policy bundle apart from a
 * policy-driven ABORT.
 */
async function readPublishedPolicyBundle(input: PublishedPolicyDecisionInput) {
  try {
    return await runWithTenantContext(input.tenantId, () =>
      getLatestPublishedBundle(input.workspaceId, input.tenantId),
    );
  } catch (error) {
    logger.error("published policy bundle read failed; failing closed", {
      op: "getLatestPublishedBundle",
      error: error instanceof Error ? error.message : String(error),
      workspaceId: input.workspaceId,
    });
    incrementCounter("spctre.gateway.policy_bundle_read_error", 1);
    throw error;
  }
}
