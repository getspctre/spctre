import { runWithTenantContext } from "@/lib/tenant-context";
import { billingMeteringService } from "@/lib/ee-adapters/billing-metering";
import { getUsagePeriod } from "@/lib/repositories/usage/metering";
import {
  claimUsageSubmission,
  composeUsageIdempotencyKey,
  recordUsageSubmissionOutcome,
} from "@/lib/repositories/usage/submissions";

export type UsageReportOutcome =
  | { status: "reported"; submissionId: string; providerSubmissionId?: string }
  | { status: "already_reported"; submissionId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; submissionId: string; error: string };

/**
 * Report a tenant's measured usage for its current billing period.
 *
 * Called without a session — the worker triggers it — so everything here runs
 * bound to the tenant. An unbound query is refused by row-level security rather
 * than returning nothing, which is the failure this wrapper exists to prevent.
 *
 * The order matters. The submission is claimed in the database *before* the
 * provider is called, so a crash between the two leaves a PENDING row naming
 * exactly what was in flight, rather than no record of an attempt that may
 * already have reached the provider.
 */
export async function reportUsageForCurrentPeriod(tenantId: string): Promise<UsageReportOutcome> {
  return runWithTenantContext(tenantId, async () => {
    const period = await getUsagePeriod(tenantId);
    if (!period) {
      return { status: "skipped", reason: "No usage period for the current billing period." };
    }

    // An unmeasured period has no defensible quantity to report. The audit
    // seeds it; until then there is nothing to bill against.
    if (period.retainedCount === null) {
      return { status: "skipped", reason: "Usage period has not been measured yet." };
    }

    const idempotencyKey = composeUsageIdempotencyKey({
      tenantId,
      periodStart: period.periodStart,
      metric: period.metric,
      entitlementVersion: period.entitlementVersion,
    });

    const claim = await claimUsageSubmission({
      tenantId,
      usagePeriodId: period.periodId,
      metric: period.metric,
      idempotencyKey,
      reportedQuantity: period.retainedCount,
      includedCapacity: period.includedCapacity,
      entitlementVersion: period.entitlementVersion,
    });
    if (!claim) {
      return { status: "skipped", reason: "Database not configured." };
    }

    // Someone already reported this period. Re-sending would ask the provider
    // to deduplicate a charge, which is exactly what this key exists to avoid
    // relying on.
    if (claim.alreadyClaimed && claim.record.status !== "FAILED") {
      return { status: "already_reported", submissionId: claim.record.id };
    }

    const result = await billingMeteringService.submitUsage({
      tenantId,
      usagePeriodId: period.periodId,
      metric: period.metric,
      idempotencyKey,
      reportedQuantity: period.retainedCount,
      includedCapacity: period.includedCapacity,
      entitlementVersion: period.entitlementVersion,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });

    if (result.status === "SKIPPED") {
      // No billing implementation is installed — an OSS or self-hosted
      // deployment. The claim row stays PENDING and is retried if one appears.
      return { status: "skipped", reason: "No billing metering implementation is installed." };
    }

    await recordUsageSubmissionOutcome({
      id: claim.record.id,
      status: result.status === "SUBMITTED" ? "SUBMITTED" : "FAILED",
      providerSubmissionId: result.providerSubmissionId ?? null,
      providerInvoiceId: result.providerInvoiceId ?? null,
      error: result.error ?? null,
    });

    if (result.status === "FAILED") {
      return {
        status: "failed",
        submissionId: claim.record.id,
        error: result.error ?? "Usage submission failed.",
      };
    }

    return {
      status: "reported",
      submissionId: claim.record.id,
      providerSubmissionId: result.providerSubmissionId,
    };
  });
}
