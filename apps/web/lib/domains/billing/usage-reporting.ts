import { runWithTenantContext } from "@/lib/tenant-context";
import { billingMeteringService } from "@/lib/ee-adapters/billing-metering";
import { enforcedEntitlementValue } from "@/lib/entitlements/catalog";
import { resolvePlanEntitlements } from "@/lib/ee-adapters/entitlement-catalog";
import { getCommercialProfile } from "@/lib/repositories/workspace";
import {
  listUnreportedClosedPeriods,
  type UsagePeriodSummary,
} from "@/lib/repositories/usage/metering";
import {
  claimUsageSubmission,
  composeUsageIdempotencyKey,
  recordUsageSubmissionOutcome,
} from "@/lib/repositories/usage/submissions";
import { logger } from "@spctre/platform/logging";

export type PeriodReportOutcome =
  | { status: "reported"; periodId: string; submissionId: string; charged: boolean }
  | { status: "already_reported"; periodId: string; submissionId: string }
  | { status: "skipped"; periodId: string; reason: string }
  | { status: "failed"; periodId: string; submissionId: string; error: string };

export interface UsageReportSummary {
  tenantId: string;
  considered: number;
  outcomes: PeriodReportOutcome[];
}

/**
 * Report every closed, unreported billing period for a tenant.
 *
 * Called without a session — the worker triggers it — so everything runs bound
 * to the tenant. An unbound query is refused by row-level security rather than
 * returning nothing, which is the failure this wrapper exists to prevent.
 *
 * Periods are reported at close rather than continuously. While a period is
 * open its retained count still moves, and the idempotency key is per-period,
 * so an early report would permanently record a figure that was still changing.
 */
export async function reportClosedPeriods(tenantId: string): Promise<UsageReportSummary> {
  return runWithTenantContext(tenantId, async () => {
    const periods = await listUnreportedClosedPeriods(tenantId);
    if (periods.length === 0) {
      return { tenantId, considered: 0, outcomes: [] };
    }

    const profile = await getCommercialProfile(tenantId);
    const outcomes: PeriodReportOutcome[] = [];
    for (const period of periods) {
      outcomes.push(await reportPeriod(tenantId, profile.planCode, period));
    }
    return { tenantId, considered: periods.length, outcomes };
  });
}

async function reportPeriod(
  tenantId: string,
  planCode: string,
  period: UsagePeriodSummary,
): Promise<PeriodReportOutcome> {
  // Narrowed by listUnreportedClosedPeriods; kept so this function is safe to
  // call directly.
  if (period.retainedCount === null) {
    return { status: "skipped", periodId: period.periodId, reason: "Period is unmeasured." };
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
    return { status: "skipped", periodId: period.periodId, reason: "Database not configured." };
  }
  if (claim.alreadyClaimed && claim.record.status !== "FAILED") {
    return { status: "already_reported", periodId: period.periodId, submissionId: claim.record.id };
  }

  const request = {
    tenantId,
    usagePeriodId: period.periodId,
    metric: period.metric,
    idempotencyKey,
    reportedQuantity: period.retainedCount,
    includedCapacity: period.includedCapacity,
    entitlementVersion: period.entitlementVersion,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  };

  const result = await billingMeteringService.submitUsage(request);

  if (result.status === "SKIPPED") {
    // No billing implementation is installed — an OSS or self-hosted
    // deployment. The claim stays PENDING and is retried if one appears.
    return {
      status: "skipped",
      periodId: period.periodId,
      reason: result.error ?? "No billing metering implementation is installed.",
    };
  }

  if (result.status === "FAILED") {
    await recordUsageSubmissionOutcome({
      id: claim.record.id,
      status: "FAILED",
      error: result.error ?? null,
    });
    return {
      status: "failed",
      periodId: period.periodId,
      submissionId: claim.record.id,
      error: result.error ?? "Usage submission failed.",
    };
  }

  const charged = await chargeOverageIfEnforced(planCode, request);

  await recordUsageSubmissionOutcome({
    id: claim.record.id,
    status: "SUBMITTED",
    providerSubmissionId: result.providerSubmissionId ?? null,
    providerInvoiceId: result.providerInvoiceId ?? null,
  });

  return { status: "reported", periodId: period.periodId, submissionId: claim.record.id, charged };
}

/**
 * Raise an overage charge, if and only if the plan's retained-event
 * entitlement is one the product actually enforces.
 *
 * This is the switch. `enforcedEntitlementValue` returns null for an
 * entitlement marked `enforced: false`, so a plan whose capacity is measured
 * but not applied reports its usage and is never billed for exceeding it.
 * Turning billing on is therefore a change to the catalog rather than to this
 * code path — which is the point, because the catalog is the thing the pricing
 * check and the product surfaces already agree with.
 *
 * A deployment with no commercial catalog resolves unmetered entitlements and
 * so never charges, which is the same answer its billing slot would give.
 *
 * A charge failure is deliberately not fatal to the report. The usage figure is
 * already with the provider and the submission is recorded; losing that because
 * a subsequent invoice call failed would make the next retry re-report a period
 * the provider has already accepted.
 */
async function chargeOverageIfEnforced(
  planCode: string,
  request: Parameters<typeof billingMeteringService.createOverageInvoiceItem>[0],
): Promise<boolean> {
  // The free tier is never billed. Its capacity *is* enforced — ingest returns
  // 429 past it — but that enforcement is a refusal, not an overage: a trial
  // tenant has no subscription through which a charge could be settled. Without
  // this, the enforced flag alone would make the free tier chargeable, and the
  // only thing preventing it would be the provider happening to have no
  // customer record.
  if (planCode === "HOSTED_TRIAL") return false;

  const enforcedCapacity = enforcedEntitlementValue(
    (await resolvePlanEntitlements(planCode)).retainedEvents,
  );
  if (enforcedCapacity === null) return false;
  if (request.reportedQuantity <= enforcedCapacity) return false;

  const charge = await billingMeteringService.createOverageInvoiceItem({
    ...request,
    includedCapacity: enforcedCapacity,
  });

  if (charge.status === "FAILED") {
    logger.error("usage.overage_charge_failed", {
      tenant_id: request.tenantId,
      usage_period_id: request.usagePeriodId,
      error: charge.error,
    });
    return false;
  }
  return charge.status === "SUBMITTED";
}
