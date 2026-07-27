import { sql } from "@/lib/db";
import type { RuntimeStack } from "@spctre/policy-schema";

export interface AgentSummary {
  agentId: string;
  environment: string;
  runtimeStack: RuntimeStack;
  runtimeAdapter?: string;
  currentArtifactHash: string;
  latestPublishedHash: string | null;
  healthStatus: "CURRENT" | "OUTDATED" | "STALE" | "UNKNOWN";
  allowCount: number;
  denyCount: number;
  warnCount: number;
  totalDecisions: number;
  connectors: string[];
  lastSeen: string;
}

export async function listAgentSummaries(
  workspaceId: string | null,
  tenantId: string
): Promise<AgentSummary[]> {
  if (!sql) return [];

  const rows = await sql<
    {
      agent_id: string;
      environment: string;
      runtime_stack: string;
      runtime_adapter: string | null;
      last_seen: Date;
      total_decisions: number;
      allow_count: number;
      deny_count: number;
      warn_count: number;
      connectors: string[];
      current_artifact_hash: string;
      latest_published_hash: string | null;
    }[]
  >`
    WITH latest_hash AS (
      SELECT DISTINCT ON (agent_id, environment, runtime_stack)
        agent_id, environment, runtime_stack, artifact_hash
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
      ORDER BY agent_id, environment, runtime_stack, created_at DESC
    ),
    latest_published AS (
      SELECT pp.artifact_hash
      FROM policy_publish pp
      JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
      WHERE pp.tenant_id = ${tenantId}
        AND (pp.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
      ORDER BY pp.published_at DESC
      LIMIT 1
    )
    SELECT
      e.agent_id,
      e.environment,
      e.runtime_stack,
      MAX(e.runtime_adapter) AS runtime_adapter,
      MAX(e.created_at) AS last_seen,
      COUNT(*)::int AS total_decisions,
      COUNT(*) FILTER (WHERE e.status = 'ALLOW')::int AS allow_count,
      COUNT(*) FILTER (WHERE e.status = 'DENY')::int AS deny_count,
      COUNT(*) FILTER (WHERE e.status = 'WARN')::int AS warn_count,
      array_agg(DISTINCT e.connector) AS connectors,
      lh.artifact_hash AS current_artifact_hash,
      lp.artifact_hash AS latest_published_hash
    FROM runtime_evidence_event e
    JOIN latest_hash lh
      ON lh.agent_id = e.agent_id
      AND lh.environment = e.environment
      AND lh.runtime_stack = e.runtime_stack
    LEFT JOIN latest_published lp ON TRUE
    WHERE e.tenant_id = ${tenantId}
      AND e.workspace_id = ${workspaceId}
    GROUP BY e.agent_id, e.environment, e.runtime_stack, lh.artifact_hash, lp.artifact_hash
    ORDER BY last_seen DESC
  `;

  const staleMs = 60 * 60 * 1000;
  const now = Date.now();

  return rows.map((row) => {
    const isStale = now - row.last_seen.getTime() > staleMs;
    const healthStatus: AgentSummary["healthStatus"] = isStale
      ? "STALE"
      : !row.latest_published_hash
        ? "UNKNOWN"
        : row.current_artifact_hash === row.latest_published_hash
          ? "CURRENT"
          : "OUTDATED";

    return {
      agentId: row.agent_id,
      environment: row.environment,
      runtimeStack: row.runtime_stack as RuntimeStack,
      runtimeAdapter: row.runtime_adapter ?? undefined,
      currentArtifactHash: row.current_artifact_hash,
      latestPublishedHash: row.latest_published_hash ?? null,
      healthStatus,
      allowCount: row.allow_count,
      denyCount: row.deny_count,
      warnCount: row.warn_count,
      totalDecisions: row.total_decisions,
      connectors: row.connectors ?? [],
      lastSeen: row.last_seen.toISOString()
    };
  });
}

export async function listAgentEvidenceDecisions(
  agentId: string,
  workspaceId: string | null,
  tenantId: string,
  limit = 50
): Promise<Array<{
  decisionId: string;
  connector: string;
  action: string;
  status: string;
  reason: string;
  createdAt: string;
}>> {
  if (!sql) return [];
  const rows = await sql<{
    decision_id: string;
    connector: string;
    action: string;
    status: string;
    reason: string;
    created_at: Date;
  }[]>`
    SELECT decision_id, connector, action, status, reason, created_at
    FROM runtime_evidence_event
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND agent_id = ${agentId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    decisionId: r.decision_id,
    connector: r.connector,
    action: r.action,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}
