import { logger } from "@spctre/platform/logging";
import { sql } from "@/lib/db";
import type { RuntimePolicyContext } from "@spctre/policy-schema";
import { hitlService } from "@/lib/ee-adapters/hitl";
import { recordConversionTelemetry } from "@/lib/repositories/onboarding/telemetry";
import { dispatchEscalationCreatedAlert } from "@/lib/domains/gateway/alerting-dispatch";

export interface RevisionAtTime {
  revisionId: string;
  branchId: string;
  artifactHash: string;
  scope: string;
}

export async function resolveRevisionAtTime(
  tenantId: string,
  workspaceId: string,
  atTimestamp: string
): Promise<RevisionAtTime | null> {
  if (!sql) return null;

  const rows = await sql<RevisionAtTime[]>`
    SELECT
      pr.id AS "revisionId",
      pb.id AS "branchId",
      pp.artifact_hash AS "artifactHash",
      pb.scope AS "scope"
    FROM policy_publish pp
    JOIN policy_revision pr ON pr.id = pp.revision_id
    JOIN policy_branch pb ON pb.id = pp.branch_id
    WHERE pp.tenant_id = ${tenantId}
      AND (pp.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
      AND pp.published_at <= ${atTimestamp}::timestamptz
    ORDER BY pp.published_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function getGatewayOutcomesForDecisions(
  tenantId: string,
  workspaceId: string,
  decisionIds: string[]
): Promise<Map<string, string>> {
  if (!sql || !decisionIds.length) return new Map();
  try {
    const rows = await sql<{ decision_id: string; outcome: string }[]>`
      SELECT decision_id, outcome
      FROM gateway_decision
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND decision_id = ANY(${decisionIds})
    `;
    return new Map(rows.map((r) => [r.decision_id, r.outcome]));
  } catch {
    return new Map();
  }
}

export async function countGatewaySessionDecisions(params: {
  tenantId: string; workspaceId: string; agentId: string; sessionId: string;
}): Promise<number> {
  if (!sql) return 0;
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM gateway_decision
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
      AND agent_id = ${params.agentId} AND session_id = ${params.sessionId}
  `;
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

export interface GatewayDecisionRecord {
  decisionId: string;
  tenantId: string;
  workspaceId: string;
  firstContext: Pick<RuntimePolicyContext, "revisionId" | "branchId"> | undefined;
  artifactHash: string;
  outcome: string;
  reason: string;
  consequence?: string;
  customerTier?: string;
  confidence?: number;
  amountUsd?: number;
  dataSensitivity?: string;
  trustScore?: number;
  contextBudget?: number;
  riskLevel: string;
  evaluatedBy: string;
  agentId?: string;
  sessionId?: string;
  shouldQueue: boolean;
  slaHours?: number;
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
}

// SQL-safe nullable values for the gateway_decision upsert.
function decisionInsertValues(record: GatewayDecisionRecord) {
  return {
    revisionId: record.firstContext?.revisionId ?? null,
    branchId: record.firstContext?.branchId ?? null,
    consequence: record.consequence ?? null,
    customerTier: record.customerTier ?? null,
    confidence: record.confidence ?? null,
    amountUsd: record.amountUsd ?? null,
    dataSensitivity: record.dataSensitivity ?? null,
    trustScore: record.trustScore ?? null,
    contextBudget: record.contextBudget ?? null,
    agentId: record.agentId ?? null,
    sessionId: record.sessionId ?? null,
    toolIntent: record.toolIntent ?? null,
    planSummary: record.planSummary ?? null,
    toolParameters: record.toolParameters ? JSON.stringify(record.toolParameters) : null,
  };
}

export async function persistGatewayDecision(record: GatewayDecisionRecord): Promise<string | null> {
  if (!sql) return null;

  const v = decisionInsertValues(record);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gateway_decision (
      tenant_id, workspace_id, decision_id, revision_id, branch_id,
      artifact_hash, outcome, reason, consequence, customer_tier,
      confidence, amount_usd, data_sensitivity, trust_score, context_budget,
      risk_level, evaluated_by, agent_id, session_id, tool_intent, plan_summary, tool_parameters
    ) VALUES (
      ${record.tenantId}, ${record.workspaceId}, ${record.decisionId},
      ${v.revisionId}, ${v.branchId},
      ${record.artifactHash}, ${record.outcome}, ${record.reason},
      ${v.consequence}, ${v.customerTier},
      ${v.confidence}, ${v.amountUsd},
      ${v.dataSensitivity}, ${v.trustScore},
      ${v.contextBudget}, ${record.riskLevel}, ${record.evaluatedBy}, ${v.agentId}, ${v.sessionId},
      ${v.toolIntent}, ${v.planSummary},
      ${v.toolParameters}::jsonb
    )
    ON CONFLICT (tenant_id, decision_id, artifact_hash)
    DO UPDATE SET
      outcome = EXCLUDED.outcome,
      reason = EXCLUDED.reason,
      consequence = EXCLUDED.consequence,
      customer_tier = EXCLUDED.customer_tier,
      confidence = EXCLUDED.confidence,
      amount_usd = EXCLUDED.amount_usd,
      data_sensitivity = EXCLUDED.data_sensitivity,
      trust_score = EXCLUDED.trust_score,
      context_budget = EXCLUDED.context_budget,
      risk_level = EXCLUDED.risk_level,
      evaluated_by = EXCLUDED.evaluated_by,
      agent_id = EXCLUDED.agent_id,
      session_id = EXCLUDED.session_id,
      tool_intent = EXCLUDED.tool_intent,
      plan_summary = EXCLUDED.plan_summary,
      tool_parameters = EXCLUDED.tool_parameters,
      evaluated_at = now()
    RETURNING id
  `;

  const gatewayDecisionId = rows[0]?.id;
  if (!gatewayDecisionId) return null;

  if (record.shouldQueue) {
    const slaHours = record.slaHours ?? 4;
    const slaDueAt = await hitlService.calculateSla(record.tenantId, new Date(), slaHours);

    await sql`
      INSERT INTO gateway_escalation_queue (
        tenant_id, workspace_id, gateway_decision_id, decision_id, revision_id,
        artifact_hash, status, sla_due_at, handoff_notes
      ) VALUES (
        ${record.tenantId}, ${record.workspaceId}, ${gatewayDecisionId}, ${record.decisionId},
        ${record.firstContext?.revisionId ?? null}, ${record.artifactHash},
        'PENDING', ${slaDueAt}, ${record.reason}
      )
      ON CONFLICT (tenant_id, decision_id)
      DO UPDATE SET
        gateway_decision_id = EXCLUDED.gateway_decision_id,
        revision_id = EXCLUDED.revision_id,
        artifact_hash = EXCLUDED.artifact_hash,
        status = 'PENDING',
        sla_due_at = EXCLUDED.sla_due_at,
        handoff_notes = EXCLUDED.handoff_notes,
        updated_at = now()
    `;

    // Trigger FIRST_HITL_ESCALATION conversion telemetry asynchronously
    recordConversionTelemetry(record.tenantId, "FIRST_HITL_ESCALATION").catch(() => {});

    // Dispatch alerting notification for new escalation (fire-and-forget)
    dispatchEscalationCreatedAlert({
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      decisionId: record.decisionId,
      riskLevel: record.riskLevel,
      reason: record.reason,
      slaDueAt: slaDueAt.toISOString(),
      consequence: record.consequence,
      dataSensitivity: record.dataSensitivity,
      toolIntent: record.toolIntent,
      planSummary: record.planSummary,
    }).catch(() => {});
  }

  return gatewayDecisionId;
}

export async function updateGatewayDecisionOutcome(
  id: string,
  tenantId: string,
  outcome: "PROCEED" | "ESCALATE" | "ABORT",
  reason: string
): Promise<boolean> {
  if (!sql) return false;

  try {
    await sql`
      UPDATE gateway_decision
      SET outcome = ${outcome},
          reason = ${reason}
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
    `;
    return true;
  } catch (err) {
    logger.error("[gateway/decisions] failed to update gateway decision outcome:", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
