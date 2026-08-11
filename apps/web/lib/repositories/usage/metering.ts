import type { TxClient } from "@/lib/db";
import { sql } from "@/lib/db";
import { resolveBillingPeriod } from "@/lib/entitlements/billing-period";

export type UsageMetric = "RETAINED_EVENTS" | "SIMULATION_EVENTS";

export interface UsagePeriodSummary {
  periodStart: string;
  periodEnd: string;
  metric: UsageMetric;
  ingestedCount: number;
  retainedCount: number | null;
  includedCapacity: number | null;
  entitlementVersion: string | null;
  overageState: "WITHIN_CAPACITY" | "OVER_CAPACITY";
  capNotifiedAt: string | null;
  measuredAt: string | null;
}

/**
 * Count one governed event against the tenant's current billing period.
 *
 * Runs inside the caller's transaction, on the branch where the evidence
 * dedupe key was newly inserted. That placement is what makes the count
 * exactly-once: `runtime_evidence_event_key` already gates ingest with
 * `ON CONFLICT (tenant_id, decision_id) DO NOTHING RETURNING decision_id`, so
 * a replayed decision id never reaches here, and a concurrent duplicate loses
 * the same race it already loses for the evidence row itself.
 *
 * The upsert is a single statement, so concurrent first-writes for a period
 * serialize on the unique index rather than racing a read-then-write. There is
 * deliberately no request-time `COUNT(*)` anywhere on this path: an unbounded
 * scan cannot be a billing authority.
 *
 * This runs on every ingest, so it stays one statement with no lookups. In
 * particular it does not read the tenant's plan to snapshot the included
 * capacity — that would add a round trip per governed event, and encoding the
 * plan-to-capacity mapping in SQL to avoid it would reintroduce exactly the
 * duplicated plan ladder the catalog removed. `included_capacity`,
 * `entitlement_version` and `retained_count` are filled by reconciliation,
 * which already reads commercial profiles and is where the cap is evaluated.
 */
export async function countIngestedEventForBilling(
  tx: TxClient,
  params: { tenantId: string; at?: Date },
): Promise<void> {
  const period = resolveBillingPeriod(params.at ?? new Date());

  await tx`
    INSERT INTO tenant_usage_period (
      tenant_id, period_start, period_end, metric, ingested_count
    ) VALUES (
      ${params.tenantId}, ${period.start}, ${period.end}, 'RETAINED_EVENTS', 1
    )
    ON CONFLICT (tenant_id, metric, period_start) DO UPDATE SET
      ingested_count = tenant_usage_period.ingested_count + 1,
      -- Maintain the standing retained gauge too, but only once it has been
      -- seeded. A NULL means the audit has not yet established a baseline, and
      -- a period row starting at 1 would claim the tenant holds a single
      -- retained event when it may hold millions from earlier months.
      retained_count = CASE
        WHEN tenant_usage_period.retained_count IS NULL THEN NULL
        ELSE tenant_usage_period.retained_count + 1
      END,
      updated_at = now()
  `;
}

/**
 * Discount events that have left the tenant's retained set.
 *
 * Retained governed events are a standing capacity, so pruning frees it again.
 * Maintaining the gauge at both ends is what lets the reconciliation job step
 * back from being the mechanism that produces the number to being the audit
 * that verifies it — a full recount is O(retained events) and cannot run often
 * enough to keep a displayed figure current.
 *
 * Only the open period is adjusted: a closed period's measurement is the record
 * of what was billed. `GREATEST(..., 0)` absorbs the transient case where
 * evidence ingested before the gauge was seeded is pruned after it, which would
 * otherwise drive the count negative. The audit corrects any residual drift.
 */
export async function discountPrunedEventsFromBilling(
  tx: TxClient,
  params: { tenantId: string; prunedCount: number },
): Promise<void> {
  if (params.prunedCount <= 0) return;

  await tx`
    UPDATE tenant_usage_period
    SET retained_count = GREATEST(retained_count - ${params.prunedCount}, 0),
        updated_at = now()
    WHERE tenant_id = ${params.tenantId}
      AND metric = 'RETAINED_EVENTS'
      AND retained_count IS NOT NULL
      AND now() >= period_start
      AND now() < period_end
  `;
}

/** The tenant's usage rows for the period containing `at`. */
export async function getUsagePeriod(
  tenantId: string,
  metric: UsageMetric = "RETAINED_EVENTS",
  at: Date = new Date(),
): Promise<UsagePeriodSummary | null> {
  if (!sql) return null;
  const period = resolveBillingPeriod(at);

  const rows = await sql<
    {
      period_start: Date;
      period_end: Date;
      metric: UsageMetric;
      ingested_count: string;
      retained_count: string | null;
      included_capacity: string | null;
      entitlement_version: string | null;
      overage_state: "WITHIN_CAPACITY" | "OVER_CAPACITY";
      cap_notified_at: Date | null;
      measured_at: Date | null;
    }[]
  >`
    SELECT period_start, period_end, metric, ingested_count, retained_count,
           included_capacity, entitlement_version, overage_state,
           cap_notified_at, measured_at
    FROM tenant_usage_period
    WHERE tenant_id = ${tenantId}
      AND metric = ${metric}
      AND period_start = ${period.start}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    metric: row.metric,
    ingestedCount: Number(row.ingested_count),
    retainedCount: row.retained_count === null ? null : Number(row.retained_count),
    includedCapacity: row.included_capacity === null ? null : Number(row.included_capacity),
    entitlementVersion: row.entitlement_version,
    overageState: row.overage_state,
    capNotifiedAt: row.cap_notified_at ? row.cap_notified_at.toISOString() : null,
    measuredAt: row.measured_at ? row.measured_at.toISOString() : null,
  };
}
