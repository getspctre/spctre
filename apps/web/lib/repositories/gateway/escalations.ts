import { logger } from "@spctre/platform/logging";
import { redactAndBoundParameters } from "@spctre/api-contracts";
import { sql } from "@/lib/db";
import type { GatewayEscalationQueueItem } from "@spctre/policy-schema";

export interface OpenEscalationSummary {
  count: number;
  nearestSlaDueAt?: string;
}

export interface ResolvedEscalation {
  id: string;
  decisionId: string;
  revisionId?: string;
  artifactHash: string;
  resolutionOutcome: "PROCEED" | "ESCALATE" | "ABORT";
  resolutionNote?: string;
  resolvedAt: string;
  slaDueAt?: string;
  slaMet?: boolean;
}

export async function getOpenEscalationSummaryForRevision(
  revisionId: string,
  tenantId: string,
): Promise<OpenEscalationSummary> {
  if (!sql || !revisionId) return { count: 0 };

  try {
    const rows = await sql<{ count: string; nearest_sla_due_at: Date | null }[]>`
      SELECT
        COUNT(*)::text AS count,
        MIN(sla_due_at) AS nearest_sla_due_at
      FROM gateway_escalation_queue geq
      WHERE tenant_id = ${tenantId}
        AND revision_id = ${revisionId}
        AND status IN ('PENDING', 'IN_REVIEW')
    `;

    const row = rows[0];
    return {
      count: Number.parseInt(row?.count ?? "0", 10),
      nearestSlaDueAt: row?.nearest_sla_due_at?.toISOString(),
    };
  } catch {
    // Migration may not be applied yet.
    return { count: 0 };
  }
}

export async function countOpenEscalations(
  workspaceId: string | null,
  tenantId: string,
): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM gateway_escalation_queue
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND status IN ('PENDING', 'IN_REVIEW')
    `;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  } catch {
    return 0;
  }
}

export async function listOpenEscalationQueue(
  workspaceId: string | null,
  tenantId: string,
  limit = 50,
): Promise<GatewayEscalationQueueItem[]> {
  // An unconfigured database is a real, non-error state (demo/dev). A query
  // failure is not: it propagates so the caller decides. GET
  // /api/gateway/escalations answers 503, and callers that genuinely prefer to
  // degrade — the workspace dashboard card — opt in with swallow() at their own
  // call site. Returning [] here would make a broken query indistinguishable
  // from a clear queue, which is how a missing column reached production
  // looking like "Queue is clear".
  if (!sql) return [];

  const rows = await sql<EscalationQueueRow[]>`
    SELECT
      geq.id, geq.tenant_id, geq.workspace_id, geq.gateway_decision_id, geq.decision_id,
      geq.revision_id, geq.artifact_hash, geq.status, geq.assigned_to, geq.sla_due_at,
      geq.handoff_notes, geq.resolved_at, geq.resolution_outcome, geq.resolution_note,
      gd.connector, gd.action,
      gd.consequence, gd.customer_tier, gd.confidence::text, gd.amount_usd::text,
      gd.data_sensitivity, gd.trust_score::text, gd.context_budget, gd.risk_level,
      gd.reason AS gateway_reason, gd.agent_id,
      gd.tool_intent, gd.plan_summary, gd.tool_parameters, gd.safeguard_telemetry,
      geq.created_at, geq.updated_at
    FROM gateway_escalation_queue geq
    JOIN gateway_decision gd ON gd.id = geq.gateway_decision_id
    WHERE geq.tenant_id = ${tenantId}
      AND geq.workspace_id = ${workspaceId}
      AND geq.status IN ('PENDING', 'IN_REVIEW')
    ORDER BY geq.sla_due_at ASC
    LIMIT ${limit}
  `;

  return rows.map(mapEscalationQueueRow);
}

// Row shape for the joined escalation-queue query above; drives both mappers.
interface EscalationQueueRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  gateway_decision_id: string;
  decision_id: string;
  revision_id: string | null;
  artifact_hash: string;
  status: GatewayEscalationQueueItem["status"];
  assigned_to: string | null;
  sla_due_at: Date;
  handoff_notes: string | null;
  resolved_at: Date | null;
  resolution_outcome: GatewayEscalationQueueItem["resolutionOutcome"] | null;
  resolution_note: string | null;
  connector: string | null;
  action: string | null;
  consequence: string | null;
  customer_tier: string | null;
  confidence: string | null;
  amount_usd: string | null;
  data_sensitivity: string | null;
  trust_score: string | null;
  context_budget: number | null;
  risk_level: GatewayEscalationQueueItem["riskLevel"] | null;
  gateway_reason: string | null;
  agent_id: string | null;
  tool_intent: string | null;
  plan_summary: string | null;
  tool_parameters: unknown;
  safeguard_telemetry: unknown;
  created_at: Date;
  updated_at: Date;
}

// Decision metadata joined from gateway_decision / runtime evidence; all
// fields are optional on the queue item.
//
// This is the *review* projection. Its consumers — the triage queue API, the
// server-rendered escalations page, and the workspace dashboard — all deliver
// it to a browser, so the canonical tool parameters must not survive this
// mapping: they would reach the client in the JSON response and the RSC props
// no matter what the rendering component chooses to display. Reviewers get a
// redacted, bounded view; the verbatim payload is reserved for the approved
// runtime handoff, which reads it through getEscalationStatusByDecisionId and
// releases it only once a human has resolved the escalation to PROCEED.
function mapEscalationDecisionFields(row: EscalationQueueRow) {
  return {
    connector: row.connector ?? undefined,
    action: row.action ?? undefined,
    consequence: row.consequence ?? undefined,
    customerTier: row.customer_tier ?? undefined,
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    amountUsd: row.amount_usd == null ? undefined : Number(row.amount_usd),
    dataSensitivity: row.data_sensitivity ?? undefined,
    trustScore: row.trust_score == null ? undefined : Number(row.trust_score),
    contextBudget: row.context_budget ?? undefined,
    riskLevel: row.risk_level ?? undefined,
    gatewayReason: row.gateway_reason ?? undefined,
    agentId: row.agent_id ?? undefined,
    toolIntent: row.tool_intent ?? undefined,
    planSummary: row.plan_summary ?? undefined,
    toolParameters: redactAndBoundParameters(row.tool_parameters),
    safeguardTelemetry:
      row.safeguard_telemetry &&
      typeof row.safeguard_telemetry === "object" &&
      !Array.isArray(row.safeguard_telemetry)
        ? (row.safeguard_telemetry as Record<string, unknown>)
        : undefined,
  };
}

function mapEscalationQueueRow(row: EscalationQueueRow): GatewayEscalationQueueItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    gatewayDecisionId: row.gateway_decision_id,
    decisionId: row.decision_id,
    revisionId: row.revision_id ?? undefined,
    artifactHash: row.artifact_hash,
    status: row.status,
    assignedTo: row.assigned_to ?? undefined,
    slaDueAt: row.sla_due_at.toISOString(),
    handoffNotes: row.handoff_notes ?? undefined,
    resolvedAt: row.resolved_at?.toISOString(),
    resolutionOutcome: row.resolution_outcome ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
    ...mapEscalationDecisionFields(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getOpenEscalationQueueItem(params: {
  queueId: string;
  tenantId: string;
  workspaceId: string;
}): Promise<GatewayEscalationQueueItem | null> {
  const items = await listOpenEscalationQueue(params.workspaceId, params.tenantId, 100);
  return items.find((item) => item.id === params.queueId) ?? null;
}

export async function getOpenEscalationAssigneeCounts(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<Record<string, number>> {
  if (!sql) return {};

  try {
    const rows = await sql<{ assigned_to: string; count: string }[]>`
      SELECT assigned_to, COUNT(*)::text AS count
      FROM gateway_escalation_queue
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND status IN ('PENDING', 'IN_REVIEW')
        AND assigned_to IS NOT NULL
      GROUP BY assigned_to
    `;
    return Object.fromEntries(rows.map((row) => [row.assigned_to, Number.parseInt(row.count, 10)]));
  } catch {
    return {};
  }
}

export async function listResolvedEscalationsForRevision(
  revisionId: string,
  tenantId: string,
): Promise<ResolvedEscalation[]> {
  if (!sql || !revisionId) return [];
  try {
    const rows = await sql<
      {
        id: string;
        decision_id: string;
        revision_id: string | null;
        artifact_hash: string;
        resolution_outcome: "PROCEED" | "ESCALATE" | "ABORT";
        resolution_note: string | null;
        resolved_at: Date;
        sla_due_at: Date | null;
      }[]
    >`
      SELECT id, decision_id, revision_id, artifact_hash,
             resolution_outcome, resolution_note, resolved_at, sla_due_at
      FROM gateway_escalation_queue
      WHERE tenant_id = ${tenantId}
        AND revision_id = ${revisionId}
        AND status = 'RESOLVED'
        AND resolution_outcome IS NOT NULL
      ORDER BY resolved_at ASC
    `;
    return rows.map((row) => ({
      id: row.id,
      decisionId: row.decision_id,
      revisionId: row.revision_id ?? undefined,
      artifactHash: row.artifact_hash,
      resolutionOutcome: row.resolution_outcome,
      resolutionNote: row.resolution_note ?? undefined,
      resolvedAt: row.resolved_at.toISOString(),
      slaDueAt: row.sla_due_at?.toISOString(),
      slaMet: row.sla_due_at ? row.resolved_at <= row.sla_due_at : undefined,
    }));
  } catch {
    return [];
  }
}

export async function resolveEscalationQueueItem(params: {
  queueId: string;
  tenantId: string;
  workspaceId: string;
  reviewedBy: string;
  resolutionOutcome: "PROCEED" | "ESCALATE" | "ABORT";
  resolutionNote?: string;
  agentGuidance?: string;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    const existingRows = await sql<
      {
        status: string;
        resolution_outcome: string | null;
        resolution_note: string | null;
        agent_guidance: string | null;
      }[]
    >`
      SELECT status, resolution_outcome, resolution_note, agent_guidance
      FROM gateway_escalation_queue
      WHERE id = ${params.queueId}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
      LIMIT 1
    `;

    const existing = existingRows[0];
    if (
      existing?.status === "RESOLVED" &&
      existing.resolution_outcome === params.resolutionOutcome &&
      (existing.resolution_note ?? null) === (params.resolutionNote ?? null) &&
      (existing.agent_guidance ?? null) === (params.agentGuidance ?? null)
    ) {
      return true;
    }

    const rows = await sql<{ id: string }[]>`
      UPDATE gateway_escalation_queue
      SET
        status = 'RESOLVED',
        resolved_at = now(),
        resolution_outcome = ${params.resolutionOutcome},
        resolution_note = ${params.resolutionNote ?? null},
        agent_guidance = ${params.agentGuidance ?? null},
        updated_at = now()
      WHERE id = ${params.queueId}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND status IN ('PENDING', 'IN_REVIEW')
      RETURNING id
    `;

    if (!rows.length) return false;

    await sql`
      UPDATE gateway_decision gd
      SET reviewed_by = ${params.reviewedBy},
          reviewed_at = now(),
          outcome = ${params.resolutionOutcome},
          reason = ${params.resolutionNote ?? "Escalation resolved."}
      FROM gateway_escalation_queue geq
      WHERE geq.id = ${params.queueId}
        AND geq.tenant_id = ${params.tenantId}
        AND gd.id = geq.gateway_decision_id
    `;

    return true;
  } catch {
    return false;
  }
}

export async function getResolvedEscalationReceiptContext(params: {
  queueId: string;
  tenantId: string;
  workspaceId: string;
}): Promise<{
  gatewayDecisionId: string;
  decisionId: string;
  branchId: string | null;
  revisionId: string | null;
  artifactHash: string;
  actorId: string;
  connector: string | null;
  action: string | null;
  riskLevel: string;
} | null> {
  if (!sql) return null;
  const rows = await sql<
    {
      gateway_decision_id: string;
      decision_id: string;
      branch_id: string | null;
      revision_id: string | null;
      artifact_hash: string;
      evaluated_by: string;
      connector: string | null;
      action: string | null;
      risk_level: string;
    }[]
  >`
    SELECT geq.gateway_decision_id, geq.decision_id, gd.branch_id, gd.revision_id,
      gd.artifact_hash, gd.evaluated_by, gd.connector, gd.action, gd.risk_level
    FROM gateway_escalation_queue geq
    JOIN gateway_decision gd ON gd.id = geq.gateway_decision_id AND gd.tenant_id = geq.tenant_id
    WHERE geq.id = ${params.queueId}
      AND geq.tenant_id = ${params.tenantId}
      AND geq.workspace_id = ${params.workspaceId}
      AND geq.status = 'RESOLVED'
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        gatewayDecisionId: row.gateway_decision_id,
        decisionId: row.decision_id,
        branchId: row.branch_id,
        revisionId: row.revision_id,
        artifactHash: row.artifact_hash,
        actorId: row.evaluated_by,
        connector: row.connector,
        action: row.action,
        riskLevel: row.risk_level,
      }
    : null;
}

export async function assignEscalationQueueItem(params: {
  queueId: string;
  tenantId: string;
  workspaceId: string;
  assignedTo: string;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    const rows = await sql<{ id: string }[]>`
      UPDATE gateway_escalation_queue
      SET
        assigned_to = ${params.assignedTo},
        status = 'IN_REVIEW',
        updated_at = now()
      WHERE id = ${params.queueId}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND status = 'PENDING'
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function assignEscalationQueueItemFromTriage(params: {
  queueId: string;
  tenantId: string;
  workspaceId: string;
  assignedTo: string;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    const rows = await sql<{ id: string }[]>`
      UPDATE gateway_escalation_queue
      SET
        assigned_to = ${params.assignedTo},
        status = 'IN_REVIEW',
        updated_at = now()
      WHERE id = ${params.queueId}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND status IN ('PENDING', 'IN_REVIEW')
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export interface EscalationStatus {
  decisionId: string;
  gatewayDecisionId: string;
  status: "PENDING" | "IN_REVIEW" | "RESOLVED" | "EXPIRED";
  resolutionOutcome?: "PROCEED" | "ESCALATE" | "ABORT";
  resolutionNote?: string;
  agentGuidance?: string;
  slaDueAt?: string;
  resolvedAt?: string;
  connector?: string;
  action?: string;
  /** Internal persisted decision arguments; only exposed as approvedToolParameters
   * after the escalation is resolved to PROCEED. Already redacted and bounded by
   * GatewayDecisionSchema at ingest, so it confirms what was reviewed rather than
   * carrying a replayable payload. */
  toolParameters?: Record<string, unknown>;
  approvedToolParameters?: Record<string, unknown>;
  credentialGrant?: {
    credentialType: string;
    injectedParameter: string;
    credentialValue: string;
    expiresAt: string;
  };
}

export async function getEscalationStatusByDecisionId(
  decisionId: string,
  tenantId: string,
  workspaceId: string,
): Promise<EscalationStatus | null> {
  // null means "no escalation for this decision" — a 404 the runtime client
  // acts on. A query failure must not borrow that meaning: it propagates so the
  // status route can answer 503, which its handler is already written for.
  if (!sql || !decisionId) return null;

  const rows = await sql<
    {
      decision_id: string;
      gateway_decision_id: string;
      status: EscalationStatus["status"];
      resolution_outcome: EscalationStatus["resolutionOutcome"] | null;
      resolution_note: string | null;
      agent_guidance: string | null;
      sla_due_at: Date | null;
      resolved_at: Date | null;
      connector: string | null;
      action: string | null;
      tool_parameters: unknown;
    }[]
  >`
    SELECT
      geq.decision_id,
      geq.gateway_decision_id,
      geq.status,
      geq.resolution_outcome,
      geq.resolution_note,
      geq.agent_guidance,
      geq.sla_due_at,
      geq.resolved_at,
      gd.connector,
      gd.action,
      gd.tool_parameters
    FROM gateway_escalation_queue geq
    JOIN gateway_decision gd ON gd.id = geq.gateway_decision_id
    WHERE geq.tenant_id = ${tenantId}
      AND geq.workspace_id = ${workspaceId}
      AND geq.decision_id = ${decisionId}
    ORDER BY geq.created_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    decisionId: row.decision_id,
    gatewayDecisionId: row.gateway_decision_id,
    status: row.status,
    resolutionOutcome: row.resolution_outcome ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
    agentGuidance: row.agent_guidance ?? undefined,
    slaDueAt: row.sla_due_at?.toISOString(),
    resolvedAt: row.resolved_at?.toISOString(),
    connector: row.connector ?? undefined,
    action: row.action ?? undefined,
    toolParameters:
      row.tool_parameters &&
      typeof row.tool_parameters === "object" &&
      !Array.isArray(row.tool_parameters)
        ? (row.tool_parameters as Record<string, unknown>)
        : undefined,
  };
}

export async function updateEscalationOutcome(params: {
  gatewayDecisionId: string;
  tenantId: string;
  workspaceId: string;
  resolutionOutcome: "PROCEED" | "ESCALATE" | "ABORT";
  resolutionNote?: string;
}): Promise<boolean> {
  if (!sql) return false;

  try {
    // 1. Update the decision outcome
    await sql`
      UPDATE gateway_decision
      SET outcome = ${params.resolutionOutcome},
          reason = ${params.resolutionNote ?? "Resolution outcome updated."}
      WHERE id = ${params.gatewayDecisionId}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
    `;

    // 2. Update the escalation queue item
    await sql`
      UPDATE gateway_escalation_queue
      SET resolution_outcome = ${params.resolutionOutcome},
          resolution_note = ${params.resolutionNote ?? null},
          status = 'RESOLVED',
          resolved_at = now(),
          updated_at = now()
      WHERE gateway_decision_id = ${params.gatewayDecisionId}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
    `;
    return true;
  } catch (err) {
    logger.error("[gateway/escalations] failed to update escalation outcome:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
