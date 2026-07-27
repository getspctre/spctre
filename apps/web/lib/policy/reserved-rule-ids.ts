import type { PolicyRuleSummary } from "@spctre/policy-schema";

export const SPCTRE_ADVISOR_RULE_ID_PREFIX = "spctre-agent.";

export function reservedStableRuleIdError(stableRuleIds: Iterable<string>): string | null {
  const reservedId = Array.from(stableRuleIds).find((stableRuleId) =>
    stableRuleId.toLowerCase().startsWith(SPCTRE_ADVISOR_RULE_ID_PREFIX)
  );

  return reservedId
    ? `Stable rule ID "${reservedId}" is reserved for Spctre Advisor Governance. Use your organization's namespace instead.`
    : null;
}

export function assertCustomerRulesDoNotUseReservedIds(rules: Pick<PolicyRuleSummary, "stableRuleId">[]): void {
  const error = reservedStableRuleIdError(rules.map((rule) => rule.stableRuleId));
  if (error) throw new Error(error);
}
