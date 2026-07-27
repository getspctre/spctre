import { branchTimeline, complianceExport, retentionPlan } from "@/lib/mock-data";
import { canUseDemoFallbackData } from "@/lib/demo-guard";
import type { CompliancePageModel } from "@/lib/domains/compliance/service";

// Audited demo-fallback consumer (see scripts/check-demo-fallbacks.mjs).
//
// The compliance report renders a sample timeline / export / retention plan in
// the demo workspace so the surface is not blank before real evidence exists.
// Each artifact is gated to the demo tenant: a real tenant with no persisted
// packet gets `null` here (the presenter shows an explicit empty state) and is
// never shown fabricated compliance evidence.
export function resolveComplianceArtifacts(
  tenantId: string,
  packet: CompliancePageModel["packet"],
  persistedRetentionPlan: CompliancePageModel["persistedRetentionPlan"],
) {
  const useDemoFallbackData = canUseDemoFallbackData(tenantId);
  return {
    activeTimeline: packet?.timeline ?? (useDemoFallbackData ? branchTimeline : null),
    activeExport: packet?.export ?? (useDemoFallbackData ? complianceExport : null),
    activeRetentionPlan: persistedRetentionPlan ?? (useDemoFallbackData ? retentionPlan : null),
  };
}
