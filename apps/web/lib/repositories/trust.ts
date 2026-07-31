import { logger } from "@spctre/platform/logging";
import { sql, rawSql } from "@/lib/db";
import { isRecord } from "@/lib/records";
import type {
  RuntimeStack,
  TrustScoreEvent,
  TrustScoreSource,
  TrustCalibrationPolicy,
  ContextBudgetEvent,
  ContextBudgetEventType,
  TrustGovernanceAction,
  TrustGovernanceResult,
} from "@spctre/policy-schema";

type TrustScoreEventRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agent_id: string;
  environment: string;
  runtime_stack: string;
  trust_score: string;
  previous_score: string | null;
  delta: string | null;
  source: string;
  source_ref: string | null;
  reason: string | null;
  created_at: Date;
};

export async function ingestTrustScoreEvent(params: {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  environment: string;
  runtimeStack: string;
  trustScore: number;
  source: TrustScoreSource;
  sourceRef?: string;
  reason?: string;
}): Promise<void> {
  if (!sql) return;
  try {
    const prevRows = await sql<{ trust_score: string }[]>`
      SELECT trust_score
      FROM agt_trust_score_event
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND agent_id = ${params.agentId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const previousScore = prevRows[0] ? Number.parseFloat(prevRows[0].trust_score) : null;
    const delta = previousScore !== null ? params.trustScore - previousScore : null;

    await sql`
      INSERT INTO agt_trust_score_event (
        tenant_id, workspace_id, agent_id, environment, runtime_stack,
        trust_score, previous_score, delta, source, source_ref, reason
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.agentId},
        ${params.environment}, ${params.runtimeStack},
        ${params.trustScore}, ${previousScore}, ${delta},
        ${params.source}, ${params.sourceRef ?? null}, ${params.reason ?? null}
      )
    `;
  } catch (err) {
    logger.error("[trust_score] ingest failed:", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function listTrustScoreHistory(
  agentId: string,
  workspaceId: string | null,
  tenantId: string,
  limit = 50
): Promise<TrustScoreEvent[]> {
  if (!sql) return [];
  try {
    const rows = await sql<TrustScoreEventRow[]>`
      SELECT id, tenant_id, workspace_id, agent_id, environment, runtime_stack,
             trust_score, previous_score, delta, source, source_ref, reason, created_at
      FROM agt_trust_score_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND agent_id = ${agentId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapTrustScoreEventRow);
  } catch {
    return [];
  }
}

// ── Cross-surface trust history ───────────────────────────────────────────────

export async function listTrustScoreHistoryCrossSurface(
  canonicalAgentId: string,
  workspaceId: string,
  tenantId: string,
  limit = 100
): Promise<TrustScoreEvent[]> {
  if (!sql) return [];
  try {
    const rows = await sql<TrustScoreEventRow[]>`
      SELECT e.id, e.tenant_id, e.workspace_id, e.agent_id, e.environment,
             e.runtime_stack, e.trust_score, e.previous_score, e.delta,
             e.source, e.source_ref, e.reason, e.created_at
      FROM agt_trust_score_event e
      WHERE e.tenant_id = ${tenantId}
        AND e.workspace_id = ${workspaceId}
        AND (
          e.agent_id = ${canonicalAgentId}
          OR e.agent_id IN (
            SELECT surface_agent_id
            FROM agt_agent_surface_binding
            WHERE tenant_id = ${tenantId}
              AND workspace_id = ${workspaceId}
              AND canonical_agent_id = ${canonicalAgentId}
          )
        )
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapTrustScoreEventRow);
  } catch {
    return [];
  }
}

function mapTrustScoreEventRow(row: TrustScoreEventRow): TrustScoreEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    environment: row.environment,
    runtimeStack: row.runtime_stack as RuntimeStack,
    trustScore: Number.parseFloat(row.trust_score),
    previousScore: row.previous_score !== null ? Number.parseFloat(row.previous_score) : undefined,
    delta: row.delta !== null ? Number.parseFloat(row.delta) : undefined,
    source: row.source as TrustScoreSource,
    sourceRef: row.source_ref ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

// ── Trust calibration policies ────────────────────────────────────────────────

export async function createTrustCalibrationPolicy(params: {
  tenantId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  agentClass?: string;
  environment?: string;
  connector?: string;
  consequenceTier?: TrustCalibrationPolicy["consequenceTier"];
  decayEnabled?: boolean;
  decayRate?: number;
  decayPeriodHours?: number;
  decayFloor?: number;
  warnThreshold?: number;
  escalateThreshold?: number;
  reviewThreshold?: number;
  contextWarnThreshold?: number;
  contextEscalateThreshold?: number;
  createdBy: string;
}): Promise<TrustCalibrationPolicy | null> {
  if (!sql) return null;
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string | null;
      name: string;
      description: string | null;
      enabled: boolean;
      agent_class: string | null;
      environment: string | null;
      connector: string | null;
      consequence_tier: string | null;
      decay_enabled: boolean;
      decay_rate: string | null;
      decay_period_hours: number | null;
      decay_floor: string | null;
      warn_threshold: string | null;
      escalate_threshold: string | null;
      review_threshold: string | null;
      context_warn_threshold: number | null;
      context_escalate_threshold: number | null;
      created_by: string;
      created_at: Date;
      updated_at: Date;
    }[]>`
      INSERT INTO trust_calibration_policy (
        tenant_id, workspace_id, name, description,
        agent_class, environment, connector, consequence_tier,
        decay_enabled, decay_rate, decay_period_hours, decay_floor,
        warn_threshold, escalate_threshold, review_threshold,
        context_warn_threshold, context_escalate_threshold,
        created_by
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId ?? null}, ${params.name}, ${params.description ?? null},
        ${params.agentClass ?? null}, ${params.environment ?? null}, ${params.connector ?? null}, ${params.consequenceTier ?? null},
        ${params.decayEnabled ?? false}, ${params.decayRate ?? null}, ${params.decayPeriodHours ?? null}, ${params.decayFloor ?? null},
        ${params.warnThreshold ?? null}, ${params.escalateThreshold ?? null}, ${params.reviewThreshold ?? null},
        ${params.contextWarnThreshold ?? null}, ${params.contextEscalateThreshold ?? null},
        ${params.createdBy}
      )
      RETURNING *
    `;
    const row = rows[0];
    if (!row) return null;
    return mapPolicyRow(row);
  } catch (err) {
    logger.error("[trust_calibration_policy] create failed:", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function listTrustCalibrationPolicies(
  tenantId: string,
  workspaceId?: string,
  options: { enabledOnly?: boolean; limit?: number } = {}
): Promise<TrustCalibrationPolicy[]> {
  if (!sql) return [];
  const limit = options.limit ?? 100;
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string | null;
      name: string;
      description: string | null;
      enabled: boolean;
      agent_class: string | null;
      environment: string | null;
      connector: string | null;
      consequence_tier: string | null;
      decay_enabled: boolean;
      decay_rate: string | null;
      decay_period_hours: number | null;
      decay_floor: string | null;
      warn_threshold: string | null;
      escalate_threshold: string | null;
      review_threshold: string | null;
      context_warn_threshold: number | null;
      context_escalate_threshold: number | null;
      created_by: string;
      created_at: Date;
      updated_at: Date;
    }[]>`
      SELECT * FROM trust_calibration_policy
      WHERE tenant_id = ${tenantId}
        ${workspaceId ? rawSql`AND (workspace_id = ${workspaceId} OR workspace_id IS NULL)` : rawSql``}
        ${options.enabledOnly ? rawSql`AND enabled = true` : rawSql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapPolicyRow);
  } catch (err) {
    logger.error("[listTrustCalibrationPolicies] failed:", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

type UpdateTrustPolicyParams = Partial<{
  name: string;
  description: string;
  enabled: boolean;
  agentClass: string;
  environment: string;
  connector: string;
  consequenceTier: TrustCalibrationPolicy["consequenceTier"];
  decayEnabled: boolean;
  decayRate: number;
  decayPeriodHours: number;
  decayFloor: number;
  warnThreshold: number;
  escalateThreshold: number;
  reviewThreshold: number;
  contextWarnThreshold: number;
  contextEscalateThreshold: number;
}>;

// SQL-safe values: undefined (field untouched) becomes null so the CASE/COALESCE
// expressions in the UPDATE can distinguish "not provided" via the paired
// `!== undefined` flags.
function updateTrustPolicyValues(params: UpdateTrustPolicyParams) {
  return {
    name: params.name ?? null,
    description: params.description ?? null,
    enabled: params.enabled ?? null,
    agentClass: params.agentClass ?? null,
    environment: params.environment ?? null,
    connector: params.connector ?? null,
    consequenceTier: params.consequenceTier ?? null,
    decayEnabled: params.decayEnabled ?? null,
    decayRate: params.decayRate ?? null,
    decayPeriodHours: params.decayPeriodHours ?? null,
    decayFloor: params.decayFloor ?? null,
    warnThreshold: params.warnThreshold ?? null,
    escalateThreshold: params.escalateThreshold ?? null,
    reviewThreshold: params.reviewThreshold ?? null,
    contextWarnThreshold: params.contextWarnThreshold ?? null,
    contextEscalateThreshold: params.contextEscalateThreshold ?? null,
  };
}

export async function updateTrustCalibrationPolicy(
  id: string,
  tenantId: string,
  params: UpdateTrustPolicyParams
): Promise<TrustCalibrationPolicy | null> {
  if (!sql) return null;
  const v = updateTrustPolicyValues(params);
  try {
    const rows = await sql<{ id: string; tenant_id: string; workspace_id: string | null; name: string; description: string | null; enabled: boolean; agent_class: string | null; environment: string | null; connector: string | null; consequence_tier: string | null; decay_enabled: boolean; decay_rate: string | null; decay_period_hours: number | null; decay_floor: string | null; warn_threshold: string | null; escalate_threshold: string | null; review_threshold: string | null; context_warn_threshold: number | null; context_escalate_threshold: number | null; created_by: string; created_at: Date; updated_at: Date; }[]>`
      UPDATE trust_calibration_policy
      SET
        name = COALESCE(${v.name}, name),
        description = COALESCE(${v.description}, description),
        enabled = COALESCE(${v.enabled}, enabled),
        agent_class = CASE WHEN ${params.agentClass !== undefined} THEN ${v.agentClass} ELSE agent_class END,
        environment = CASE WHEN ${params.environment !== undefined} THEN ${v.environment} ELSE environment END,
        connector = CASE WHEN ${params.connector !== undefined} THEN ${v.connector} ELSE connector END,
        consequence_tier = CASE WHEN ${params.consequenceTier !== undefined} THEN ${v.consequenceTier} ELSE consequence_tier END,
        decay_enabled = COALESCE(${v.decayEnabled}, decay_enabled),
        decay_rate = CASE WHEN ${params.decayRate !== undefined} THEN ${v.decayRate} ELSE decay_rate END,
        decay_period_hours = CASE WHEN ${params.decayPeriodHours !== undefined} THEN ${v.decayPeriodHours} ELSE decay_period_hours END,
        decay_floor = CASE WHEN ${params.decayFloor !== undefined} THEN ${v.decayFloor} ELSE decay_floor END,
        warn_threshold = CASE WHEN ${params.warnThreshold !== undefined} THEN ${v.warnThreshold} ELSE warn_threshold END,
        escalate_threshold = CASE WHEN ${params.escalateThreshold !== undefined} THEN ${v.escalateThreshold} ELSE escalate_threshold END,
        review_threshold = CASE WHEN ${params.reviewThreshold !== undefined} THEN ${v.reviewThreshold} ELSE review_threshold END,
        context_warn_threshold = CASE WHEN ${params.contextWarnThreshold !== undefined} THEN ${v.contextWarnThreshold} ELSE context_warn_threshold END,
        context_escalate_threshold = CASE WHEN ${params.contextEscalateThreshold !== undefined} THEN ${v.contextEscalateThreshold} ELSE context_escalate_threshold END,
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    const row = rows[0];
    return row ? mapPolicyRow(row) : null;
  } catch (err) {
    logger.error("[trust_calibration_policy] update failed:", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function deleteTrustCalibrationPolicy(id: string, tenantId: string): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`
      DELETE FROM trust_calibration_policy
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    return true;
  } catch {
    return false;
  }
}

function mapPolicyRow(row: {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  agent_class: string | null;
  environment: string | null;
  connector: string | null;
  consequence_tier: string | null;
  decay_enabled: boolean;
  decay_rate: string | null;
  decay_period_hours: number | null;
  decay_floor: string | null;
  warn_threshold: string | null;
  escalate_threshold: string | null;
  review_threshold: string | null;
  context_warn_threshold: number | null;
  context_escalate_threshold: number | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}): TrustCalibrationPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled,
    agentClass: row.agent_class ?? undefined,
    environment: row.environment ?? undefined,
    connector: row.connector ?? undefined,
    consequenceTier: (row.consequence_tier as TrustCalibrationPolicy["consequenceTier"]) ?? undefined,
    decayEnabled: row.decay_enabled,
    decayRate: row.decay_rate !== null ? Number.parseFloat(row.decay_rate) : undefined,
    decayPeriodHours: row.decay_period_hours ?? undefined,
    decayFloor: row.decay_floor !== null ? Number.parseFloat(row.decay_floor) : undefined,
    warnThreshold: row.warn_threshold !== null ? Number.parseFloat(row.warn_threshold) : undefined,
    escalateThreshold: row.escalate_threshold !== null ? Number.parseFloat(row.escalate_threshold) : undefined,
    reviewThreshold: row.review_threshold !== null ? Number.parseFloat(row.review_threshold) : undefined,
    contextWarnThreshold: row.context_warn_threshold ?? undefined,
    contextEscalateThreshold: row.context_escalate_threshold ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ── Context budget telemetry ──────────────────────────────────────────────────

export async function ingestContextBudgetEvent(params: {
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  agentId: string;
  environment: string;
  runtimeStack: string;
  eventType: ContextBudgetEventType;
  tokenCount: number;
  tokenDelta?: number;
  contextSourceMix?: Record<string, number>;
  budgetLimit?: number;
  budgetUtilization?: number;
  governanceAction?: TrustGovernanceAction;
  policyRef?: string;
}): Promise<string | null> {
  if (!sql) return null;
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO context_budget_event (
        tenant_id, workspace_id, session_id, agent_id, environment, runtime_stack,
        event_type, token_count, token_delta, context_source_mix,
        budget_limit, budget_utilization, governance_action, policy_ref
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.sessionId}, ${params.agentId},
        ${params.environment}, ${params.runtimeStack},
        ${params.eventType}, ${params.tokenCount}, ${params.tokenDelta ?? null},
        ${sql.json(params.contextSourceMix ?? {})}::jsonb,
        ${params.budgetLimit ?? null}, ${params.budgetUtilization ?? null},
        ${params.governanceAction ?? null}, ${params.policyRef ?? null}
      )
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error("[context_budget_event] ingest failed:", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function listContextBudgetEvents(
  tenantId: string,
  workspaceId: string | null,
  options: { sessionId?: string; agentId?: string; eventType?: ContextBudgetEventType; limit?: number } = {}
): Promise<ContextBudgetEvent[]> {
  if (!sql) return [];
  const limit = options.limit ?? 100;
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      session_id: string;
      agent_id: string;
      environment: string;
      runtime_stack: string;
      event_type: string;
      token_count: number;
      token_delta: number | null;
      context_source_mix: unknown;
      budget_limit: number | null;
      budget_utilization: string | null;
      governance_action: string | null;
      policy_ref: string | null;
      created_at: Date;
    }[]>`
      SELECT * FROM context_budget_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        ${options.sessionId ? rawSql`AND session_id = ${options.sessionId}` : rawSql``}
        ${options.agentId ? rawSql`AND agent_id = ${options.agentId}` : rawSql``}
        ${options.eventType ? rawSql`AND event_type = ${options.eventType}` : rawSql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      environment: row.environment,
      runtimeStack: row.runtime_stack as RuntimeStack,
      eventType: row.event_type as ContextBudgetEventType,
      tokenCount: row.token_count,
      tokenDelta: row.token_delta ?? undefined,
      contextSourceMix: (isRecord(row.context_source_mix) ? row.context_source_mix : {}) as ContextBudgetEvent["contextSourceMix"],
      budgetLimit: row.budget_limit ?? undefined,
      budgetUtilization: row.budget_utilization !== null ? Number.parseFloat(row.budget_utilization) : undefined,
      governanceAction: (row.governance_action as TrustGovernanceAction) ?? undefined,
      policyRef: row.policy_ref ?? undefined,
      createdAt: row.created_at.toISOString(),
    }));
  } catch {
    return [];
  }
}

// ── Trust governance evaluation ───────────────────────────────────────────────

export function evaluateTrustGovernance(params: {
  trustScore?: number;
  contextTokens?: number;
  budgetLimit?: number;
  agentClass?: string;
  environment?: string;
  connector?: string;
  consequenceTier?: TrustCalibrationPolicy["consequenceTier"];
  policies: TrustCalibrationPolicy[];
}): TrustGovernanceResult {
  const evaluatedAt = new Date().toISOString();
  const { trustScore, contextTokens, budgetLimit } = params;
  const budgetUtilization =
    contextTokens !== undefined && budgetLimit && budgetLimit > 0
      ? contextTokens / budgetLimit
      : undefined;

  const matching = params.policies.filter((p) => {
    if (!p.enabled) return false;
    if (p.agentClass && p.agentClass !== params.agentClass) return false;
    if (p.environment && p.environment !== params.environment) return false;
    if (p.connector && p.connector !== params.connector) return false;
    if (p.consequenceTier && p.consequenceTier !== params.consequenceTier) return false;
    return true;
  });

  let action: TrustGovernanceAction = "ALLOW";
  let reason = "Trust score and context budget within policy bounds.";
  let matchedPolicyId: string | undefined;
  let matchedPolicyName: string | undefined;
  let recommendedRiskLevel: TrustGovernanceResult["recommendedRiskLevel"] = "LOW";

  for (const policy of matching) {
    if (trustScore !== undefined) {
      if (policy.escalateThreshold !== undefined && trustScore < policy.escalateThreshold) {
        action = "ESCALATE";
        reason = `Trust score ${trustScore.toFixed(3)} is below escalation threshold ${policy.escalateThreshold.toFixed(3)}.`;
        matchedPolicyId = policy.id;
        matchedPolicyName = policy.name;
        recommendedRiskLevel = "HIGH";
        break;
      }
      if (policy.reviewThreshold !== undefined && trustScore < policy.reviewThreshold) {
        action = "REVIEW";
        reason = `Trust score ${trustScore.toFixed(3)} is below review threshold ${policy.reviewThreshold.toFixed(3)}.`;
        matchedPolicyId = policy.id;
        matchedPolicyName = policy.name;
        recommendedRiskLevel = "MEDIUM";
      }
      if (policy.warnThreshold !== undefined && trustScore < policy.warnThreshold) {
        if (action === "ALLOW") {
          action = "WARN";
          reason = `Trust score ${trustScore.toFixed(3)} is below warn threshold ${policy.warnThreshold.toFixed(3)}.`;
          matchedPolicyId = policy.id;
          matchedPolicyName = policy.name;
          recommendedRiskLevel = "MEDIUM";
        }
      }
    }
    if (contextTokens !== undefined) {
      if (policy.contextEscalateThreshold !== undefined && contextTokens > policy.contextEscalateThreshold) {
        action = "ESCALATE";
        reason = `Context token count ${contextTokens} exceeds escalation threshold ${policy.contextEscalateThreshold}.`;
        matchedPolicyId = policy.id;
        matchedPolicyName = policy.name;
        recommendedRiskLevel = "HIGH";
        break;
      }
      if (policy.contextWarnThreshold !== undefined && contextTokens > policy.contextWarnThreshold) {
        if (action === "ALLOW") {
          action = "WARN";
          reason = `Context token count ${contextTokens} exceeds warn threshold ${policy.contextWarnThreshold}.`;
          matchedPolicyId = policy.id;
          matchedPolicyName = policy.name;
          recommendedRiskLevel = "MEDIUM";
        }
      }
    }
  }

  return {
    action,
    reason,
    matchedPolicyId,
    matchedPolicyName,
    trustScore,
    contextTokens,
    budgetUtilization,
    recommendedRiskLevel,
    evaluatedAt,
  };
}
