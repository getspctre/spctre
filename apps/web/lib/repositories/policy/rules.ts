import { sql, rawSql } from "@/lib/db";
import { listRulesForRevision } from "@/lib/repositories/shared/rules";
import type { PolicyRuleSummary } from "@spctre/policy-schema";

const ADVISOR_GOVERNANCE_PACK_SOURCE_PATH = "packs/spctre-agent-governance-v1.json";

export interface RuleHeatEntry {
  ruleId: string;
  denyCount: number;
  warnCount: number;
  allowCount: number;
  total: number;
}

export interface UnusedRule {
  stableRuleId: string;
  title: string;
  effect: string;
  connectors: string[];
  domains: string[];
}

export interface BlastRadius {
  affectedAgents: number;
  affectedConnectors: string[];
  affectedEnvironments: string[];
  totalDecisions: number;
  denyCount: number;
  warnCount: number;
  changedRuleCount: number;
}

export async function listRules(
  workspaceId: string | null,
  tenantId: string,
  searchText?: string,
): Promise<PolicyRuleSummary[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      stable_rule_id: string;
      title: string;
      effect: string;
      source_path: string | null;
      domains: string[];
      connectors: string[];
      actions: string[];
      immutable: boolean;
    }[]
  >`
    SELECT DISTINCT ON (pr.stable_rule_id)
      pr.stable_rule_id, pr.title, pr.effect, pr.source_path,
      pr.domains, pr.connectors, pr.actions, pr.immutable
    FROM policy_rule pr
    JOIN policy_revision rev ON rev.id = pr.revision_id AND rev.tenant_id = pr.tenant_id
    JOIN policy_branch pb ON pb.id = rev.branch_id AND pb.tenant_id = rev.tenant_id AND pb.active_revision_id = rev.id
    WHERE pr.tenant_id = ${tenantId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
      ${
        searchText
          ? rawSql`AND (
        pr.search_text @@ websearch_to_tsquery('english', ${searchText})
        OR pr.effect ILIKE ${"%" + searchText + "%"}
        OR pr.stable_rule_id ILIKE ${"%" + searchText + "%"}
      )`
          : rawSql``
      }
    ORDER BY pr.stable_rule_id, pb.created_at DESC
  `;
  return rows.map((row) => ({
    stableRuleId: row.stable_rule_id,
    title: row.title,
    effect: row.effect as PolicyRuleSummary["effect"],
    sourceFormat: "AGT_YAML" as const,
    sourcePath: row.source_path ?? undefined,
    domains: row.domains ?? [],
    connectors: row.connectors ?? [],
    actions: row.actions ?? [],
    immutable: row.immutable ?? false,
  }));
}

export async function getRulesForRevision(
  revisionId: string,
  tenantId: string,
): Promise<PolicyRuleSummary[]> {
  if (!revisionId) return [];
  return listRulesForRevision(revisionId, tenantId);
}

export async function getHighFrictionRules(
  limit = 10,
  workspaceId: string | null,
  tenantId: string,
): Promise<RuleHeatEntry[]> {
  if (!sql) return [];

  const rows = await sql<
    {
      rule_id: string;
      deny_count: number;
      warn_count: number;
      allow_count: number;
      total: number;
    }[]
  >`
    SELECT
      ref AS rule_id,
      COUNT(*) FILTER (WHERE status = 'DENY')::int AS deny_count,
      COUNT(*) FILTER (WHERE status = 'WARN')::int  AS warn_count,
      COUNT(*) FILTER (WHERE status = 'ALLOW')::int AS allow_count,
      COUNT(*)::int AS total
    FROM (
      SELECT unnest(policy_refs) AS ref, status
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
    ) refs
    WHERE ref != ''
    GROUP BY ref
    HAVING COUNT(*) FILTER (WHERE status IN ('DENY', 'WARN')) > 0
    ORDER BY deny_count DESC, warn_count DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    ruleId: r.rule_id,
    denyCount: r.deny_count,
    warnCount: r.warn_count,
    allowCount: r.allow_count,
    total: r.total,
  }));
}

export async function getUnusedActiveRules(
  workspaceId: string | null,
  tenantId: string,
): Promise<UnusedRule[]> {
  if (!sql) return [];

  const rows = await sql<
    {
      stable_rule_id: string;
      title: string;
      effect: string;
      connectors: string[];
      domains: string[];
    }[]
  >`
    SELECT DISTINCT ON (pr.stable_rule_id)
      pr.stable_rule_id,
      pr.title,
      pr.effect,
      pr.connectors,
      pr.domains
    FROM policy_rule pr
    JOIN policy_branch pb ON pb.active_revision_id = pr.revision_id AND pb.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ${tenantId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
      -- This is a Spctre-managed advisor governance baseline, not a candidate for customer cleanup.
      AND COALESCE(pr.source_path, '') <> ${ADVISOR_GOVERNANCE_PACK_SOURCE_PATH}
      AND NOT EXISTS (
        SELECT 1 FROM runtime_evidence_event e
        WHERE e.tenant_id = ${tenantId}
          AND e.workspace_id = ${workspaceId}
          AND pr.stable_rule_id = ANY(e.policy_refs)
      )
    ORDER BY pr.stable_rule_id
  `;

  return rows.map((r) => ({
    stableRuleId: r.stable_rule_id,
    title: r.title,
    effect: r.effect,
    connectors: r.connectors ?? [],
    domains: r.domains ?? [],
  }));
}

export async function getBlastRadius(
  changedRuleIds: string[],
  workspaceId: string | null,
  tenantId: string,
): Promise<BlastRadius | null> {
  if (!sql || !changedRuleIds.length) return null;

  const rows = await sql<
    {
      affected_agents: number;
      affected_connectors: string[];
      affected_environments: string[];
      total_decisions: number;
      deny_count: number;
      warn_count: number;
    }[]
  >`
    WITH affected AS (
      SELECT agent_id, connector, environment, status
      FROM runtime_evidence_event
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        AND EXISTS (
          SELECT 1 FROM unnest(policy_refs) AS ref
          WHERE ref = ANY(${changedRuleIds})
        )
    )
    SELECT
      COUNT(DISTINCT agent_id)::int                                   AS affected_agents,
      COALESCE(array_agg(DISTINCT connector)  FILTER (WHERE connector  IS NOT NULL), '{}') AS affected_connectors,
      COALESCE(array_agg(DISTINCT environment) FILTER (WHERE environment IS NOT NULL), '{}') AS affected_environments,
      COUNT(*)::int                                                   AS total_decisions,
      COUNT(*) FILTER (WHERE status = 'DENY')::int                   AS deny_count,
      COUNT(*) FILTER (WHERE status = 'WARN')::int                   AS warn_count
    FROM affected
  `;

  const row = rows[0];
  if (!row || row.total_decisions === 0) return null;

  return {
    affectedAgents: row.affected_agents,
    affectedConnectors: row.affected_connectors ?? [],
    affectedEnvironments: row.affected_environments ?? [],
    totalDecisions: row.total_decisions,
    denyCount: row.deny_count,
    warnCount: row.warn_count,
    changedRuleCount: changedRuleIds.length,
  };
}
