import { sql } from "@/lib/db";

export type ProductionHeartbeatDriftStatus = "CURRENT" | "DRIFTED" | "PROVENANCE_GAP" | "STALE";

export interface ProductionHeartbeatObservation {
  agentId: string;
  environment: string;
  runtimeStack: string;
  runtimeAdapter: string | null;
  artifactHash: string;
  policyContext: unknown;
  observedAt: string;
}

/**
 * Reads only the dedicated heartbeat action emitted by `spctre watch --heartbeat`
 * and compatible production adapters. General tool evidence is deliberately not
 * eligible to prove runtime assurance.
 */
export async function listProductionHeartbeatObservations(params: {
  tenantId: string;
  workspaceId: string | null;
}): Promise<ProductionHeartbeatObservation[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      agent_id: string;
      environment: string;
      runtime_stack: string;
      runtime_adapter: string | null;
      artifact_hash: string;
      policy_context: unknown;
      created_at: Date;
    }[]
  >`
    SELECT DISTINCT ON (agent_id, environment, runtime_stack, COALESCE(runtime_adapter, ''))
      agent_id, environment, runtime_stack, runtime_adapter, artifact_hash, policy_context, created_at
    FROM runtime_evidence_event
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND environment = 'production'
      AND action = 'heartbeat'
    ORDER BY agent_id, environment, runtime_stack, COALESCE(runtime_adapter, ''), created_at DESC
  `;
  return rows.map((row) => ({
    agentId: row.agent_id,
    environment: row.environment,
    runtimeStack: row.runtime_stack,
    runtimeAdapter: row.runtime_adapter,
    artifactHash: row.artifact_hash,
    policyContext: row.policy_context,
    observedAt: row.created_at.toISOString(),
  }));
}

export interface PolicyScopedRuntimeObservation {
  agentId: string;
  environment: string;
  runtimeStack: string;
  runtimeAdapter: string | null;
  artifactHash: string;
  connectors: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProductionConnectorActionObservation {
  connector: string;
  actions: string[];
  decisions: number;
  agents: number;
  decisionsWithPolicyRefs: number;
  lastSeenAt: string;
}

/** Production-only coverage input from runtime evidence, not generic telemetry. */
export async function listProductionConnectorActionObservations(params: {
  tenantId: string;
  workspaceId: string | null;
}): Promise<ProductionConnectorActionObservation[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      connector: string;
      actions: string[];
      decisions: string;
      agents: string;
      decisions_with_policy_refs: string;
      last_seen_at: Date;
    }[]
  >`
    SELECT
      connector,
      array_agg(DISTINCT action ORDER BY action) AS actions,
      COUNT(*)::text AS decisions,
      COUNT(DISTINCT agent_id)::text AS agents,
      COUNT(*) FILTER (WHERE cardinality(policy_refs) > 0)::text AS decisions_with_policy_refs,
      MAX(created_at) AS last_seen_at
    FROM runtime_evidence_event
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND environment = 'production'
      AND action <> 'heartbeat'
      AND created_at >= now() - interval '30 days'
    GROUP BY connector
    ORDER BY last_seen_at DESC, decisions DESC
  `;
  return rows.map((row) => ({
    connector: row.connector,
    actions: row.actions ?? [],
    decisions: Number(row.decisions),
    agents: Number(row.agents),
    decisionsWithPolicyRefs: Number(row.decisions_with_policy_refs),
    lastSeenAt: row.last_seen_at.toISOString(),
  }));
}

/**
 * Returns bounded leads from runtime evidence that already references policy.
 * This is explicitly not a cloud, SaaS, or network discovery mechanism.
 */
export async function listPolicyScopedRuntimeObservations(params: {
  tenantId: string;
  workspaceId: string | null;
}): Promise<PolicyScopedRuntimeObservation[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      agent_id: string;
      environment: string;
      runtime_stack: string;
      runtime_adapter: string | null;
      artifact_hash: string;
      connectors: string[];
      first_seen_at: Date;
      last_seen_at: Date;
    }[]
  >`
    WITH latest_artifact AS (
      SELECT DISTINCT ON (agent_id, environment, runtime_stack, COALESCE(runtime_adapter, ''))
        agent_id, environment, runtime_stack, runtime_adapter, artifact_hash
      FROM runtime_evidence_event
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND environment = 'production'
        AND action <> 'heartbeat'
        AND cardinality(policy_refs) > 0
        AND created_at >= now() - interval '30 days'
      ORDER BY agent_id, environment, runtime_stack, COALESCE(runtime_adapter, ''), created_at DESC
    )
    SELECT
      e.agent_id, e.environment, e.runtime_stack, e.runtime_adapter,
      la.artifact_hash,
      array_agg(DISTINCT e.connector) AS connectors,
      MIN(e.created_at) AS first_seen_at,
      MAX(e.created_at) AS last_seen_at
    FROM runtime_evidence_event e
    JOIN latest_artifact la
      ON la.agent_id = e.agent_id
      AND la.environment = e.environment
      AND la.runtime_stack = e.runtime_stack
      AND la.runtime_adapter IS NOT DISTINCT FROM e.runtime_adapter
    WHERE e.tenant_id = ${params.tenantId}
      AND e.workspace_id = ${params.workspaceId}
      AND e.environment = 'production'
      AND e.action <> 'heartbeat'
      AND cardinality(e.policy_refs) > 0
      AND e.created_at >= now() - interval '30 days'
    GROUP BY e.agent_id, e.environment, e.runtime_stack, e.runtime_adapter, la.artifact_hash
    ORDER BY last_seen_at DESC
  `;
  return rows.map((row) => ({
    agentId: row.agent_id,
    environment: row.environment,
    runtimeStack: row.runtime_stack,
    runtimeAdapter: row.runtime_adapter,
    artifactHash: row.artifact_hash,
    connectors: row.connectors ?? [],
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  }));
}

export interface RuntimeAssuranceHistoryPoint {
  observedAt: string;
  artifactHash: string;
  decisions: number;
}

/** Bounded evidence-derived artifact history; not an infrastructure telemetry feed. */
export async function listRuntimeAssuranceHistory(params: {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  limit?: number;
}): Promise<RuntimeAssuranceHistoryPoint[]> {
  if (!sql) return [];
  const limit = Math.max(1, Math.min(params.limit ?? 168, 720));
  const rows = await sql<{ observed_at: Date; artifact_hash: string; decisions: string }[]>`
    SELECT date_trunc('hour', created_at) AS observed_at, artifact_hash, COUNT(*)::text AS decisions
    FROM runtime_evidence_event
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId} AND agent_id = ${params.agentId}
    GROUP BY date_trunc('hour', created_at), artifact_hash
    ORDER BY observed_at DESC LIMIT ${limit}`;
  return rows.map((row) => ({
    observedAt: row.observed_at.toISOString(),
    artifactHash: row.artifact_hash,
    decisions: Number(row.decisions),
  }));
}
