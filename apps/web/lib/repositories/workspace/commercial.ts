import { rawSql, runWithTenantContext, sql } from "@/lib/db";
import type { JSONValue } from "postgres";
import {
  recordConversionTelemetry,
  type ConversionTelemetryEventType,
} from "@/lib/repositories/onboarding/telemetry";
import { ENTITLEMENT_CATALOG_VERSION, planEntitlements } from "@/lib/entitlements/catalog";
import { swallow } from "@/lib/platform/swallow";

export interface CommercialUsageSummary {
  workspaceCount: number;
  policyBundleCount: number;
  retainedAuditEventCount: number;
  productionEnvironmentCount: number;
  serviceTokenCount: number;
}

export interface CommercialProfile {
  planCode: CommercialPlanCode;
  lifecycleStatus: "EVALUATING" | "ACTIVE" | "EXPANDING" | "PAUSED";
  salesStatus: "NONE" | "REQUESTED" | "QUALIFIED" | "CONTRACTING" | "CUSTOMER";
  billingContactEmail: string | null;
  updatedAt: string | null;
  downgradedAt?: string | null;
  retentionWindowDays?: number | null;
}

export type CommercialPlanCode = "HOSTED_TRIAL" | "TEAM" | "BUSINESS" | "ENTERPRISE";

export interface BillingLifecycleEvent {
  tenantId?: string | null;
  billingCustomerId?: string | null;
  billingProvider: "PADDLE";
  planCode?: string | null;
  lifecycleStatus: CommercialProfile["lifecycleStatus"];
  salesStatus: CommercialProfile["salesStatus"];
  telemetryEventType: ConversionTelemetryEventType;
  metadata?: Record<string, unknown>;
}

export interface CommercialEventSummary {
  id: string;
  eventType: string;
  targetPlan: string | null;
  actor: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function getCommercialUsageSummary(
  workspaceId: string | null,
  tenantId: string,
): Promise<CommercialUsageSummary> {
  if (!sql) {
    return {
      workspaceCount: 0,
      policyBundleCount: 0,
      retainedAuditEventCount: 0,
      productionEnvironmentCount: 0,
      serviceTokenCount: 0,
    };
  }

  const [workspaceRows, publishRows, evidenceRows, environmentRows, serviceTokenRows] =
    await Promise.all([
      sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM workspace
      WHERE tenant_id = ${tenantId}
    `,
      sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM policy_publish pp
      JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
      WHERE pp.tenant_id = ${tenantId}
        AND (pp.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    `,
      sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
    `,
      sql<{ count: string }[]>`
      SELECT COUNT(DISTINCT environment)::text AS count
      FROM (
        SELECT environment
        FROM runtime_evidence_event
        WHERE tenant_id = ${tenantId}
          AND workspace_id = ${workspaceId}
        UNION
        SELECT environment
        FROM policy_publish
        WHERE tenant_id = ${tenantId}
          AND workspace_id = ${workspaceId}
      ) environments
      WHERE environment IS NOT NULL AND environment <> ''
    `,
      sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM service_token
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND revoked_at IS NULL
    `.catch(swallow("sql", [{ count: "0" }])),
    ]);

  return {
    workspaceCount: parseInt(workspaceRows[0]?.count ?? "0", 10),
    policyBundleCount: parseInt(publishRows[0]?.count ?? "0", 10),
    retainedAuditEventCount: parseInt(evidenceRows[0]?.count ?? "0", 10),
    productionEnvironmentCount: parseInt(environmentRows[0]?.count ?? "0", 10),
    serviceTokenCount: parseInt(serviceTokenRows[0]?.count ?? "0", 10),
  };
}

export async function getCommercialProfile(tenantId: string): Promise<CommercialProfile> {
  const fallback: CommercialProfile = {
    planCode: "HOSTED_TRIAL",
    lifecycleStatus: "EVALUATING",
    salesStatus: "NONE",
    billingContactEmail: null,
    updatedAt: null,
  };
  if (!sql) return fallback;

  try {
    const rows = await sql<
      {
        plan_code: string;
        lifecycle_status: CommercialProfile["lifecycleStatus"];
        sales_status: CommercialProfile["salesStatus"];
        billing_contact_email: string | null;
        updated_at: Date;
        downgraded_at: Date | null;
        retention_window_days: number | null;
      }[]
    >`
      SELECT plan_code, lifecycle_status, sales_status, billing_contact_email, updated_at, downgraded_at, retention_window_days
      FROM tenant_commercial_profile
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return fallback;
    return {
      planCode: normalizeCommercialPlanCode(row.plan_code),
      lifecycleStatus: row.lifecycle_status,
      salesStatus: row.sales_status,
      billingContactEmail: row.billing_contact_email,
      updatedAt: row.updated_at.toISOString(),
      downgradedAt: row.downgraded_at ? row.downgraded_at.toISOString() : null,
      retentionWindowDays: row.retention_window_days,
    };
  } catch {
    return fallback;
  }
}

export async function getCommercialProfileWithContext(
  tenantId: string,
): Promise<CommercialProfile> {
  return runWithTenantContext(tenantId, () => getCommercialProfile(tenantId));
}

export function normalizeCommercialPlanCode(
  planCode: string | null | undefined,
): CommercialPlanCode {
  if (planCode === "OSS_EVALUATION" || !planCode) return "HOSTED_TRIAL";
  if (planCode === "TEAM" || planCode === "BUSINESS" || planCode === "ENTERPRISE") return planCode;
  return "HOSTED_TRIAL";
}

export async function resolveTenantIdByBillingCustomerId(
  billingProvider: BillingLifecycleEvent["billingProvider"],
  billingCustomerId: string,
): Promise<string | null> {
  if (!rawSql) return null;
  const rows = await rawSql<{ tenant_id: string }[]>`
    SELECT tenant_id
    FROM tenant_commercial_profile
    WHERE billing_provider = ${billingProvider}
      AND billing_customer_id = ${billingCustomerId}
    LIMIT 1
  `;
  return rows[0]?.tenant_id ?? null;
}

export async function recordBillingLifecycleEvent(
  event: BillingLifecycleEvent,
): Promise<{ tenantId: string } | null> {
  if (!sql) return null;
  const tenantId =
    event.tenantId?.trim() ||
    (event.billingCustomerId
      ? await resolveTenantIdByBillingCustomerId(event.billingProvider, event.billingCustomerId)
      : null);
  if (!tenantId) return null;

  const planCode = event.planCode ? normalizeCommercialPlanCode(event.planCode) : null;
  const insertPlanCode = planCode ?? "HOSTED_TRIAL";

  await runWithTenantContext(tenantId, async () => {
    // The effective retention window is rewritten only when the plan actually
    // changes. A lifecycle event that leaves the plan alone (a payment, a
    // status transition) must not reset the window, or a negotiated Enterprise
    // term would be silently replaced by the catalog default. When the plan
    // does change, the prior negotiated window no longer describes the tenant's
    // entitlement and the new plan's default takes over.
    const entitlements = planEntitlements(insertPlanCode);
    await sql`
      INSERT INTO tenant_commercial_profile (
        tenant_id, plan_code, lifecycle_status, sales_status,
        billing_provider, billing_customer_id, updated_at,
        retention_window_days, retained_event_capacity,
        entitlement_version, entitlement_effective_at
      ) VALUES (
        ${tenantId}, ${insertPlanCode}, ${event.lifecycleStatus}, ${event.salesStatus},
        ${event.billingProvider}, ${event.billingCustomerId ?? null}, now(),
        ${entitlements.retentionWindowDays.value}, ${entitlements.retainedEvents.value},
        ${ENTITLEMENT_CATALOG_VERSION}, now()
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_code = CASE
          WHEN ${planCode}::text IS NULL THEN tenant_commercial_profile.plan_code
          ELSE EXCLUDED.plan_code
        END,
        lifecycle_status = EXCLUDED.lifecycle_status,
        sales_status = EXCLUDED.sales_status,
        billing_provider = EXCLUDED.billing_provider,
        billing_customer_id = coalesce(EXCLUDED.billing_customer_id, tenant_commercial_profile.billing_customer_id),
        retention_window_days = CASE
          WHEN ${planCode}::text IS NOT NULL
            AND tenant_commercial_profile.plan_code IS DISTINCT FROM EXCLUDED.plan_code
          THEN EXCLUDED.retention_window_days
          ELSE tenant_commercial_profile.retention_window_days
        END,
        retained_event_capacity = CASE
          WHEN ${planCode}::text IS NOT NULL
            AND tenant_commercial_profile.plan_code IS DISTINCT FROM EXCLUDED.plan_code
          THEN EXCLUDED.retained_event_capacity
          ELSE tenant_commercial_profile.retained_event_capacity
        END,
        entitlement_version = CASE
          WHEN ${planCode}::text IS NOT NULL
            AND tenant_commercial_profile.plan_code IS DISTINCT FROM EXCLUDED.plan_code
          THEN EXCLUDED.entitlement_version
          ELSE tenant_commercial_profile.entitlement_version
        END,
        entitlement_effective_at = CASE
          WHEN ${planCode}::text IS NOT NULL
            AND tenant_commercial_profile.plan_code IS DISTINCT FROM EXCLUDED.plan_code
          THEN EXCLUDED.entitlement_effective_at
          ELSE tenant_commercial_profile.entitlement_effective_at
        END,
        updated_at = now()
    `;

    await recordConversionTelemetry(tenantId, event.telemetryEventType, event.metadata ?? {});
  });
  return { tenantId };
}

export async function listCommercialEvents(
  workspaceId: string | null,
  tenantId: string,
  limit = 6,
): Promise<CommercialEventSummary[]> {
  if (!sql) return [];

  try {
    const rows = await sql<
      {
        id: string;
        event_type: string;
        target_plan: string | null;
        display_name: string | null;
        metadata: unknown;
        created_at: Date;
      }[]
    >`
      SELECT
        ce.id,
        ce.event_type,
        ce.target_plan,
        p.display_name,
        ce.metadata,
        ce.created_at
      FROM commercial_event ce
      LEFT JOIN app_principal p ON p.id = ce.principal_id AND p.tenant_id = ce.tenant_id
      WHERE ce.tenant_id = ${tenantId}
        AND (ce.workspace_id = ${workspaceId} OR ce.workspace_id IS NULL)
      ORDER BY ce.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      targetPlan: row.target_plan,
      actor: row.display_name,
      metadata:
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {},
      createdAt: row.created_at.toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function requestCommercialReview(params: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  targetPlan: string;
  note: string;
  workspaceSlug: string;
  requestedBy: string;
}): Promise<void> {
  if (!sql) return;
  await sql.begin(async (tx) => {
    // Only the sales status changes here, so the existing window is left
    // alone on conflict. The insert branch still provisions one: this is a
    // profile-creating path, and a row with no window would be invisible to
    // the retention worker.
    await tx`
      INSERT INTO tenant_commercial_profile (
        tenant_id, plan_code, lifecycle_status, sales_status, updated_by, updated_at,
        retention_window_days, retained_event_capacity,
        entitlement_version, entitlement_effective_at
      ) VALUES (
        ${params.tenantId}, 'HOSTED_TRIAL', 'EVALUATING',
        'REQUESTED', ${params.principalId}, now(),
        ${planEntitlements("HOSTED_TRIAL").retentionWindowDays.value},
        ${planEntitlements("HOSTED_TRIAL").retainedEvents.value},
        ${ENTITLEMENT_CATALOG_VERSION}, now()
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        sales_status = 'REQUESTED',
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `;
    await tx`
      INSERT INTO commercial_event (
        tenant_id, workspace_id, principal_id, event_type, target_plan, metadata
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
        'COMMERCIAL_REVIEW_REQUESTED', ${params.targetPlan},
        ${tx.json({ note: params.note, workspaceSlug: params.workspaceSlug, requestedBy: params.requestedBy } as JSONValue)}
      )
    `;
    await tx`
      INSERT INTO admin_audit_event (
        tenant_id, workspace_id, principal_id, action, target_type, target_id,
        outcome, reason, metadata
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
        'commercial.review_request', 'tenant_commercial_profile', ${params.tenantId},
        'ALLOWED', ${`Requested ${params.targetPlan} commercial review`},
        ${tx.json({ targetPlan: params.targetPlan, note: params.note } as JSONValue)}
      )
    `.catch(swallow("tx", undefined));
  });
}
