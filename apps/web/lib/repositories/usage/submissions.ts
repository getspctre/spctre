import { sql } from "@/lib/db";

export type UsageSubmissionStatus = "PENDING" | "SUBMITTED" | "SETTLED" | "FAILED";

export interface UsageSubmissionRecord {
  id: string;
  idempotencyKey: string;
  reportedQuantity: number;
  status: UsageSubmissionStatus;
  providerSubmissionId: string | null;
  providerInvoiceId: string | null;
  attemptCount: number;
  lastError: string | null;
}

/**
 * Compose the key that makes a submission idempotent.
 *
 * Derived from what the submission *is*, never from when it was attempted: a
 * retry after a timeout must produce the same key as the attempt it is
 * retrying, or the tenant is charged twice for one period.
 *
 * The entitlement version participates deliberately. A catalog change
 * mid-period means the figure was measured against a different capacity, which
 * makes it a different submission rather than a duplicate.
 */
export function composeUsageIdempotencyKey(params: {
  tenantId: string;
  periodStart: string;
  metric: string;
  entitlementVersion: string | null;
}): string {
  return [
    params.tenantId,
    params.periodStart,
    params.metric,
    params.entitlementVersion ?? "unversioned",
  ].join(":");
}

/**
 * Claim the right to submit a period's usage.
 *
 * Returns the existing row when the key has been seen before, so a caller can
 * tell a first attempt from a retry without a separate read. The insert is the
 * claim: two workers racing to report the same period both call this, and the
 * unique index decides which one proceeds.
 */
export async function claimUsageSubmission(params: {
  tenantId: string;
  usagePeriodId: string;
  metric: string;
  idempotencyKey: string;
  reportedQuantity: number;
  includedCapacity: number | null;
  entitlementVersion: string | null;
}): Promise<{ record: UsageSubmissionRecord; alreadyClaimed: boolean } | null> {
  if (!sql) return null;

  const rows = await sql<
    {
      id: string;
      idempotency_key: string;
      reported_quantity: string;
      status: UsageSubmissionStatus;
      provider_submission_id: string | null;
      provider_invoice_id: string | null;
      attempt_count: number;
      last_error: string | null;
      inserted: boolean;
    }[]
  >`
    WITH claimed AS (
      INSERT INTO tenant_usage_submission (
        tenant_id, usage_period_id, metric, idempotency_key,
        reported_quantity, included_capacity, entitlement_version
      ) VALUES (
        ${params.tenantId}, ${params.usagePeriodId}, ${params.metric}, ${params.idempotencyKey},
        ${params.reportedQuantity}, ${params.includedCapacity}, ${params.entitlementVersion}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *, true AS inserted
    )
    SELECT * FROM claimed
    UNION ALL
    SELECT *, false AS inserted FROM tenant_usage_submission
    WHERE idempotency_key = ${params.idempotencyKey}
      AND NOT EXISTS (SELECT 1 FROM claimed)
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    alreadyClaimed: !row.inserted,
    record: {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      reportedQuantity: Number(row.reported_quantity),
      status: row.status,
      providerSubmissionId: row.provider_submission_id,
      providerInvoiceId: row.provider_invoice_id,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
    },
  };
}

/** Record the outcome of an attempt against the provider. */
export async function recordUsageSubmissionOutcome(params: {
  id: string;
  status: UsageSubmissionStatus;
  providerSubmissionId?: string | null;
  providerInvoiceId?: string | null;
  error?: string | null;
}): Promise<void> {
  if (!sql) return;

  await sql`
    UPDATE tenant_usage_submission
    SET status = ${params.status},
        provider_submission_id = COALESCE(${params.providerSubmissionId ?? null}, provider_submission_id),
        provider_invoice_id = COALESCE(${params.providerInvoiceId ?? null}, provider_invoice_id),
        last_error = ${params.error ?? null},
        attempt_count = attempt_count + 1,
        submitted_at = CASE
          WHEN ${params.status} IN ('SUBMITTED', 'SETTLED') THEN COALESCE(submitted_at, now())
          ELSE submitted_at
        END,
        settled_at = CASE WHEN ${params.status} = 'SETTLED' THEN now() ELSE settled_at END,
        updated_at = now()
    WHERE id = ${params.id}::uuid
  `;
}
