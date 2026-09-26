import { beforeEach, describe, expect, it, vi } from "vitest";

// Usage reporting decides whether a tenant is billed, from a worker job with no
// session behind it. Every branch here is a money decision or an idempotency
// decision, and none of them were covered.
//
// The two that matter most: a trial tenant is never charged, whatever its
// entitlement says, because it has no subscription through which a charge could
// settle; and a failed overage charge must not fail the report, because the
// usage figure is already with the provider and re-reporting it would double
// count.

const listUnreportedClosedPeriodsSpy = vi.fn();
const getCommercialProfileSpy = vi.fn();
const claimUsageSubmissionSpy = vi.fn();
const recordUsageSubmissionOutcomeSpy = vi.fn();
const submitUsageSpy = vi.fn();
const createOverageInvoiceItemSpy = vi.fn();
const resolvePlanEntitlementsSpy = vi.fn();
const enforcedEntitlementValueSpy = vi.fn();
const loggerErrorSpy = vi.fn();

vi.mock("@/lib/repositories/usage/metering", () => ({
  listUnreportedClosedPeriods: listUnreportedClosedPeriodsSpy,
}));
vi.mock("@/lib/repositories/usage/submissions", () => ({
  claimUsageSubmission: claimUsageSubmissionSpy,
  recordUsageSubmissionOutcome: recordUsageSubmissionOutcomeSpy,
  composeUsageIdempotencyKey: (params: Record<string, unknown>) =>
    `key:${params.tenantId}:${params.periodStart}:${params.metric}:${params.entitlementVersion}`,
}));
vi.mock("@/lib/repositories/workspace", () => ({ getCommercialProfile: getCommercialProfileSpy }));
vi.mock("@/lib/ee-adapters/billing-metering", () => ({
  billingMeteringService: {
    submitUsage: submitUsageSpy,
    createOverageInvoiceItem: createOverageInvoiceItemSpy,
  },
}));
vi.mock("@/lib/ee-adapters/entitlement-catalog", () => ({
  resolvePlanEntitlements: resolvePlanEntitlementsSpy,
}));
vi.mock("@/lib/entitlements/catalog", () => ({
  enforcedEntitlementValue: enforcedEntitlementValueSpy,
}));
vi.mock("@spctre/platform/logging", () => ({ logger: { error: loggerErrorSpy } }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));

const { reportClosedPeriods } = await import("../lib/domains/billing/usage-reporting");

const TENANT = "tenant-1";

function period(overrides: Record<string, unknown> = {}) {
  return {
    periodId: "period-1",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    metric: "retained_events",
    entitlementVersion: 4,
    retainedCount: 1_500,
    includedCapacity: 1_000,
    ...overrides,
  };
}

function onPlan(planCode: string, salesStatus = "CUSTOMER") {
  getCommercialProfileSpy.mockResolvedValue({ planCode, salesStatus });
}

beforeEach(() => {
  vi.clearAllMocks();
  listUnreportedClosedPeriodsSpy.mockResolvedValue([period()]);
  onPlan("BUSINESS");
  claimUsageSubmissionSpy.mockResolvedValue({
    alreadyClaimed: false,
    record: { id: "submission-1", status: "PENDING" },
  });
  submitUsageSpy.mockResolvedValue({ status: "SUBMITTED", providerSubmissionId: "prov-1" });
  resolvePlanEntitlementsSpy.mockResolvedValue({ retainedEvents: { value: 1_000 } });
  enforcedEntitlementValueSpy.mockReturnValue(1_000);
  createOverageInvoiceItemSpy.mockResolvedValue({ status: "SUBMITTED" });
  recordUsageSubmissionOutcomeSpy.mockResolvedValue(undefined);
});

describe("nothing to report", () => {
  it("does not look up the commercial profile when no period is closed", async () => {
    listUnreportedClosedPeriodsSpy.mockResolvedValue([]);

    const summary = await reportClosedPeriods(TENANT);

    expect(summary).toEqual({ tenantId: TENANT, considered: 0, outcomes: [] });
    expect(getCommercialProfileSpy).not.toHaveBeenCalled();
    expect(claimUsageSubmissionSpy).not.toHaveBeenCalled();
  });

  it("skips an unmeasured period rather than reporting a zero", async () => {
    listUnreportedClosedPeriodsSpy.mockResolvedValue([period({ retainedCount: null })]);

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.outcomes).toEqual([
      { status: "skipped", periodId: "period-1", reason: "Period is unmeasured." },
    ]);
    expect(claimUsageSubmissionSpy).not.toHaveBeenCalled();
  });
});

describe("claiming a submission", () => {
  it("keys the claim per tenant, period, metric and entitlement version", async () => {
    // The key is what stops a period being reported twice. Dropping any part of
    // it would let a re-run submit the same usage under a fresh key.
    await reportClosedPeriods(TENANT);

    expect(claimUsageSubmissionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "key:tenant-1:2026-08-01T00:00:00.000Z:retained_events:4",
        reportedQuantity: 1_500,
        usagePeriodId: "period-1",
      }),
    );
  });

  it("reports a period already claimed as already_reported without resubmitting", async () => {
    claimUsageSubmissionSpy.mockResolvedValue({
      alreadyClaimed: true,
      record: { id: "submission-1", status: "SUBMITTED" },
    });

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.outcomes).toEqual([
      { status: "already_reported", periodId: "period-1", submissionId: "submission-1" },
    ]);
    expect(submitUsageSpy).not.toHaveBeenCalled();
  });

  it("retries a claim whose previous attempt failed", async () => {
    claimUsageSubmissionSpy.mockResolvedValue({
      alreadyClaimed: true,
      record: { id: "submission-1", status: "FAILED" },
    });

    const summary = await reportClosedPeriods(TENANT);

    expect(submitUsageSpy).toHaveBeenCalled();
    expect(summary.outcomes[0].status).toBe("reported");
  });

  it("skips when there is no database to claim against", async () => {
    claimUsageSubmissionSpy.mockResolvedValue(null);

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.outcomes).toEqual([
      { status: "skipped", periodId: "period-1", reason: "Database not configured." },
    ]);
    expect(submitUsageSpy).not.toHaveBeenCalled();
  });
});

describe("the metering provider's answer", () => {
  it("leaves the claim pending when no billing implementation is installed", async () => {
    // OSS and self-hosted deployments. The claim must stay PENDING so a later
    // install picks the period up rather than skipping it forever.
    submitUsageSpy.mockResolvedValue({ status: "SKIPPED", error: "No metering slot." });

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.outcomes).toEqual([
      { status: "skipped", periodId: "period-1", reason: "No metering slot." },
    ]);
    expect(recordUsageSubmissionOutcomeSpy).not.toHaveBeenCalled();
  });

  it("records a failure against the submission", async () => {
    submitUsageSpy.mockResolvedValue({ status: "FAILED", error: "provider rejected" });

    const summary = await reportClosedPeriods(TENANT);

    expect(recordUsageSubmissionOutcomeSpy).toHaveBeenCalledWith({
      id: "submission-1",
      status: "FAILED",
      error: "provider rejected",
    });
    expect(summary.outcomes).toEqual([
      {
        status: "failed",
        periodId: "period-1",
        submissionId: "submission-1",
        error: "provider rejected",
      },
    ]);
    expect(createOverageInvoiceItemSpy).not.toHaveBeenCalled();
  });

  it("records the provider identifiers on success", async () => {
    submitUsageSpy.mockResolvedValue({
      status: "SUBMITTED",
      providerSubmissionId: "prov-1",
      providerInvoiceId: "inv-1",
    });

    await reportClosedPeriods(TENANT);

    expect(recordUsageSubmissionOutcomeSpy).toHaveBeenCalledWith({
      id: "submission-1",
      status: "SUBMITTED",
      providerSubmissionId: "prov-1",
      providerInvoiceId: "inv-1",
    });
  });
});

describe("who gets charged for overage", () => {
  it("never charges a trial tenant, whatever the entitlement says", async () => {
    // The free tier's capacity is enforced at ingest with a 429, which is a
    // refusal rather than an overage: there is no subscription to settle a
    // charge against. Without this branch the enforced flag alone would make
    // the free tier chargeable.
    onPlan("HOSTED_TRIAL");

    const summary = await reportClosedPeriods(TENANT);

    expect(createOverageInvoiceItemSpy).not.toHaveBeenCalled();
    expect(resolvePlanEntitlementsSpy).not.toHaveBeenCalled();
    expect(summary.outcomes[0]).toMatchObject({ status: "reported", charged: false });
  });

  it("never charges an internal grant, whatever its plan says", async () => {
    // An internal account — an employee, a tester, a dogfood tenant — has no
    // subscription behind it, so an overage charge has nothing to settle
    // against. Same reasoning as the trial tier, different reason for existing.
    onPlan("BUSINESS", "INTERNAL");

    const summary = await reportClosedPeriods(TENANT);

    expect(createOverageInvoiceItemSpy).not.toHaveBeenCalled();
    expect(resolvePlanEntitlementsSpy).not.toHaveBeenCalled();
    expect(summary.outcomes[0]).toMatchObject({ status: "reported", charged: false });
  });

  it("still measures and reports an internal grant's usage", async () => {
    // Only the charge is skipped. Losing the measurement would make a dogfood
    // tenant invisible in the usage surfaces it exists to exercise.
    onPlan("ENTERPRISE", "INTERNAL");

    const summary = await reportClosedPeriods(TENANT);

    expect(submitUsageSpy).toHaveBeenCalledTimes(1);
    expect(summary.outcomes[0]).toMatchObject({ status: "reported" });
  });

  it("does not charge when the entitlement is measured but not enforced", async () => {
    // enforcedEntitlementValue returns null for `enforced: false`, so turning
    // billing on is a catalog change rather than a code change.
    enforcedEntitlementValueSpy.mockReturnValue(null);

    const summary = await reportClosedPeriods(TENANT);

    expect(createOverageInvoiceItemSpy).not.toHaveBeenCalled();
    expect(summary.outcomes[0]).toMatchObject({ charged: false });
  });

  it("does not charge usage at or under the enforced capacity", async () => {
    listUnreportedClosedPeriodsSpy.mockResolvedValue([period({ retainedCount: 1_000 })]);

    const summary = await reportClosedPeriods(TENANT);

    expect(createOverageInvoiceItemSpy).not.toHaveBeenCalled();
    expect(summary.outcomes[0]).toMatchObject({ charged: false });
  });

  it("charges against the enforced capacity, not the period's own figure", async () => {
    // The period carries the capacity measured at the time; the charge must use
    // the capacity the catalog enforces now, or the billed overage is wrong.
    listUnreportedClosedPeriodsSpy.mockResolvedValue([
      period({ retainedCount: 5_000, includedCapacity: 250 }),
    ]);
    enforcedEntitlementValueSpy.mockReturnValue(1_000);

    const summary = await reportClosedPeriods(TENANT);

    expect(createOverageInvoiceItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reportedQuantity: 5_000, includedCapacity: 1_000 }),
    );
    expect(summary.outcomes[0]).toMatchObject({ charged: true });
  });
});

describe("a failed charge does not fail the report", () => {
  it("still records the submission and reports charged: false", async () => {
    // The usage figure is already with the provider. Failing the report would
    // make the next run re-report a period the provider has accepted.
    createOverageInvoiceItemSpy.mockResolvedValue({ status: "FAILED", error: "no customer" });

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.outcomes[0]).toMatchObject({ status: "reported", charged: false });
    expect(recordUsageSubmissionOutcomeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUBMITTED" }),
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "usage.overage_charge_failed",
      expect.objectContaining({ tenant_id: TENANT, usage_period_id: "period-1" }),
    );
  });

  it("reports charged: false for any non-submitted charge status", async () => {
    createOverageInvoiceItemSpy.mockResolvedValue({ status: "SKIPPED" });

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.outcomes[0]).toMatchObject({ status: "reported", charged: false });
  });
});

describe("multiple periods", () => {
  it("reports each one and counts what it considered", async () => {
    listUnreportedClosedPeriodsSpy.mockResolvedValue([
      period({ periodId: "p-1" }),
      period({ periodId: "p-2", retainedCount: null }),
      period({ periodId: "p-3" }),
    ]);

    const summary = await reportClosedPeriods(TENANT);

    expect(summary.considered).toBe(3);
    expect(summary.outcomes.map((o) => `${o.periodId}:${o.status}`)).toEqual([
      "p-1:reported",
      "p-2:skipped",
      "p-3:reported",
    ]);
  });
});
