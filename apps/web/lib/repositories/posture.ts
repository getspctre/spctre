import { sql } from "@/lib/db";

export interface PostureRuleRow {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  branchId: string;
  revisionId: string;
  scope: string;
  stableRuleId: string;
  title: string;
  effect: string;
  domains: string[];
  connectors: string[];
  actions: string[];
  immutable: boolean;
}

/** A bounded comparison of declared organization and workspace policy. */
export async function listPostureRuleRows(
  tenantId: string,
): Promise<{
  orgRules: PostureRuleRow[];
  workspaceRules: PostureRuleRow[];
  workspaceCount: number;
}> {
  if (!sql) return { orgRules: [], workspaceRules: [], workspaceCount: 0 };

  const [workspaceRows, orgRules, workspaceRules] = await Promise.all([
    sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM workspace WHERE tenant_id = ${tenantId}
    `,
    sql<PostureRuleRow[]>`
      SELECT '' AS "workspaceId", 'organization' AS "workspaceSlug", 'Organization Baseline' AS "workspaceName",
        pb.id AS "branchId", pr.id AS "revisionId", pb.scope, rule.stable_rule_id AS "stableRuleId",
        rule.title, rule.effect, rule.domains, rule.connectors, rule.actions, rule.immutable
      FROM policy_branch pb
      JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
      JOIN policy_rule rule ON rule.revision_id = pr.id AND rule.tenant_id = pr.tenant_id
      WHERE pb.tenant_id = ${tenantId} AND pb.scope = 'ORGANIZATION'
      ORDER BY rule.stable_rule_id
    `,
    sql<PostureRuleRow[]>`
      SELECT w.id AS "workspaceId", w.slug AS "workspaceSlug", w.name AS "workspaceName",
        pb.id AS "branchId", pr.id AS "revisionId", pb.scope, rule.stable_rule_id AS "stableRuleId",
        rule.title, rule.effect, rule.domains, rule.connectors, rule.actions, rule.immutable
      FROM policy_branch pb
      JOIN workspace w ON w.id = pb.workspace_id AND w.tenant_id = pb.tenant_id
      JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
      JOIN policy_rule rule ON rule.revision_id = pr.id AND rule.tenant_id = pr.tenant_id
      WHERE pb.tenant_id = ${tenantId} AND pb.scope <> 'ORGANIZATION'
      ORDER BY w.slug, rule.stable_rule_id
    `,
  ]);

  return { orgRules, workspaceRules, workspaceCount: workspaceRows[0]?.count ?? 0 };
}
