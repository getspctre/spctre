import { logger } from "@spctre/platform/logging";
import { sql } from "@/lib/db";
import { parseAgtPolicyDocument } from "@spctre/policy-schema";
import type { CompositionLayer, PolicyBranch, PolicyRuleSummary } from "@spctre/policy-schema";
import { stableHash } from "@/lib/repositories/shared/revisions";

async function loadRulesForRevisions(
  revisionIds: string[],
  tenantId: string,
): Promise<Map<string, PolicyRuleSummary[]>> {
  const rulesByRevision = new Map<string, PolicyRuleSummary[]>();
  if (!revisionIds.length || !sql) return rulesByRevision;

  // 1. Fetch revisions with source_document
  const revisionRows = await sql<
    { id: string; source_document: unknown; source_path: string | null }[]
  >`
    SELECT id, source_document, source_path
    FROM policy_revision
    WHERE tenant_id = ${tenantId} AND id = ANY(${revisionIds})
  `;

  const parsedRevisions = new Set<string>();

  for (const row of revisionRows) {
    if (row.source_document) {
      try {
        const docStr =
          typeof row.source_document === "string"
            ? row.source_document
            : JSON.stringify(row.source_document);
        const parsed = parseAgtPolicyDocument({
          document: docStr,
          sourcePath: row.source_path ?? undefined,
        });
        if (parsed.rules && parsed.rules.length > 0) {
          rulesByRevision.set(row.id, parsed.rules);
          parsedRevisions.add(row.id);
        }
      } catch (e) {
        logger.error(`Failed to parse source_document for revision ${row.id} in composition:`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // 2. For any revisions that couldn't be parsed or had no rules, fall back to policy_rule table
  const fallbackIds = revisionIds.filter((id) => !parsedRevisions.has(id));
  if (fallbackIds.length > 0) {
    const allRuleRows = await sql<
      {
        revision_id: string;
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
      SELECT revision_id, stable_rule_id, title, effect, source_path,
             domains, connectors, actions, immutable
      FROM policy_rule
      WHERE tenant_id = ${tenantId} AND revision_id = ANY(${fallbackIds})
      ORDER BY stable_rule_id
    `;

    for (const row of allRuleRows) {
      const rule: PolicyRuleSummary = {
        stableRuleId: row.stable_rule_id,
        title: row.title,
        effect: row.effect as PolicyRuleSummary["effect"],
        sourceFormat: "AGT_YAML" as const,
        sourcePath: row.source_path ?? undefined,
        domains: row.domains ?? [],
        connectors: row.connectors ?? [],
        actions: row.actions ?? [],
        immutable: row.immutable ?? false,
      };
      const existing = rulesByRevision.get(row.revision_id) ?? [];
      existing.push(rule);
      rulesByRevision.set(row.revision_id, existing);
    }
  }

  return rulesByRevision;
}

export async function listActiveCompositionLayers(
  workspaceId: string | null,
  tenantId: string,
): Promise<CompositionLayer[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      branch_id: string;
      revision_id: string;
      scope: string;
      source_hash: string;
      artifact_hash: string | null;
    }[]
  >`
    SELECT
      pb.id AS branch_id,
      pr.id AS revision_id,
      pb.scope,
      pr.source_hash,
      pr.artifact_hash
    FROM policy_branch pb
    JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
    WHERE pb.tenant_id = ${tenantId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    ORDER BY
      CASE pb.scope
        WHEN 'ORGANIZATION' THEN 1
        WHEN 'WORKSPACE' THEN 2
        WHEN 'ENVIRONMENT' THEN 3
        WHEN 'CONNECTOR' THEN 4
        ELSE 5
      END,
      pb.created_at ASC
  `;

  if (!rows.length) return [];

  const revisionIds = rows.map((r) => r.revision_id);
  const rulesByRevision = await loadRulesForRevisions(revisionIds, tenantId);

  return rows.map((row) => {
    const rules = rulesByRevision.get(row.revision_id) ?? [];
    return {
      scope: row.scope as PolicyBranch["scope"],
      branchId: row.branch_id,
      revisionId: row.revision_id,
      ruleCount: rules.length,
      artifactHash: row.artifact_hash ?? stableHash(row.source_hash),
      rules,
    };
  });
}

export async function listPublishedCompositionLayers(
  workspaceId: string | null,
  tenantId: string,
): Promise<CompositionLayer[]> {
  if (!sql) return [];
  const rows = await sql<
    { branch_id: string; revision_id: string; scope: string; artifact_hash: string }[]
  >`
    WITH latest_publish AS (
      SELECT DISTINCT ON (pp.branch_id)
        pp.branch_id,
        pp.revision_id,
        pp.artifact_hash,
        pp.published_at
      FROM policy_publish pp
      JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
      WHERE pp.tenant_id = ${tenantId}
        AND (pp.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
      ORDER BY pp.branch_id, pp.published_at DESC
    )
    SELECT
      pb.id AS branch_id,
      lp.revision_id,
      pb.scope,
      lp.artifact_hash
    FROM latest_publish lp
    JOIN policy_branch pb ON pb.id = lp.branch_id AND pb.tenant_id = ${tenantId}
    WHERE pb.tenant_id = ${tenantId}
    ORDER BY
      CASE pb.scope
        WHEN 'ORGANIZATION' THEN 1
        WHEN 'WORKSPACE' THEN 2
        WHEN 'ENVIRONMENT' THEN 3
        WHEN 'CONNECTOR' THEN 4
        ELSE 5
      END,
      lp.published_at ASC
  `;

  if (!rows.length) return [];

  const revisionIds = rows.map((row) => row.revision_id);
  const rulesByRevision = await loadRulesForRevisions(revisionIds, tenantId);

  return rows.map((row) => {
    const rules = rulesByRevision.get(row.revision_id) ?? [];
    return {
      scope: row.scope as PolicyBranch["scope"],
      branchId: row.branch_id,
      revisionId: row.revision_id,
      ruleCount: rules.length,
      artifactHash: row.artifact_hash,
      rules,
    };
  });
}
