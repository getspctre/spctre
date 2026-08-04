import { rules as mockRules } from "@/lib/mock-data";
import { canUseDemoFallbackData } from "@/lib/demo-guard";

// Audited demo-fallback consumer (see scripts/check-demo-fallbacks.mjs).
//
// Sample rules exist so the rules inventory has something to show in the demo
// workspace before any real policy is authored. They are gated to the demo
// tenant: a real tenant with no database rows gets an explicit empty list here
// and is populated from the database by the caller — never fabricated rows.
export function selectDemoRulesFallback(
  tenantId: string,
  normalizedQuery?: string,
): typeof mockRules {
  if (!canUseDemoFallbackData(tenantId)) return [];
  if (!normalizedQuery) return mockRules;
  return mockRules.filter((rule) =>
    [
      rule.title,
      rule.stableRuleId,
      rule.effect,
      ...(rule.connectors ?? []),
      ...(rule.actions ?? []),
      ...(rule.domains ?? []),
    ].some((value) => Boolean(value?.toLowerCase().includes(normalizedQuery))),
  );
}
