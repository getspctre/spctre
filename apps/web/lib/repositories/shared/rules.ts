import { logger } from "@spctre/platform/logging";
import { sql } from "@/lib/db";
import { parseAgtPolicyDocument } from "@spctre/policy-schema";
import type { PolicyRuleSummary } from "@spctre/policy-schema";

type PolicyRuleDbRow = {
  stable_rule_id: string;
  title: string;
  effect: string;
  source_path: string | null;
  domains: string[];
  connectors: string[];
  actions: string[];
  immutable: boolean;
};

function mapPolicyRuleRow(row: PolicyRuleDbRow): PolicyRuleSummary {
  return {
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
}

// Parse rules from a revision's source_document, mirroring the "prefer
// source_document, else fall back to policy_rule" contract. Returns null when
// there is no document, it fails to parse, or it yields no rules — signalling
// the caller to fall back to the policy_rule table.
function parseRulesFromSourceDocument(
  sourceDocument: unknown,
  sourcePath: string | null,
  revisionId: string,
): PolicyRuleSummary[] | null {
  if (!sourceDocument) return null;
  try {
    const docStr =
      typeof sourceDocument === "string" ? sourceDocument : JSON.stringify(sourceDocument);
    const parsed = parseAgtPolicyDocument({
      document: docStr,
      sourcePath: sourcePath ?? undefined,
    });
    if (parsed.rules && parsed.rules.length > 0) {
      return parsed.rules;
    }
  } catch (e) {
    logger.error(`Failed to parse source_document for revision ${revisionId}:`, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return null;
}

export async function listRulesForRevision(
  revisionId: string,
  tenantId: string,
): Promise<PolicyRuleSummary[]> {
  if (!sql) return [];

  // Try loading from policy_revision.source_document first
  const revisionRows = await sql<{ source_document: unknown; source_path: string | null }[]>`
    SELECT source_document, source_path
    FROM policy_revision
    WHERE tenant_id = ${tenantId} AND id = ${revisionId}
    LIMIT 1
  `;
  const rev = revisionRows[0];
  const parsed = rev
    ? parseRulesFromSourceDocument(rev.source_document, rev.source_path, revisionId)
    : null;
  if (parsed) return parsed;

  const rows = await sql<PolicyRuleDbRow[]>`
    SELECT stable_rule_id, title, effect, source_path, domains, connectors, actions, immutable
    FROM policy_rule
    WHERE tenant_id = ${tenantId} AND revision_id = ${revisionId}
    ORDER BY stable_rule_id
  `;

  return rows.map(mapPolicyRuleRow);
}

// Batched variant of listRulesForRevision: resolves rules for many revisions in
// two queries (revisions, then a single policy_rule fallback) instead of one or
// two per revision. Preserves the same per-revision parse-first semantics —
// each revision independently prefers its source_document and only falls back to
// policy_rule when that yields nothing. See database-optimizations-audit (Minor).
export async function listRulesForRevisions(
  revisionIds: string[],
  tenantId: string,
): Promise<Map<string, PolicyRuleSummary[]>> {
  const result = new Map<string, PolicyRuleSummary[]>();
  if (!sql) return result;
  const uniqueIds = Array.from(new Set(revisionIds.filter((id): id is string => !!id)));
  if (uniqueIds.length === 0) return result;

  const revisionRows = await sql<
    { id: string; source_document: unknown; source_path: string | null }[]
  >`
    SELECT id, source_document, source_path
    FROM policy_revision
    WHERE tenant_id = ${tenantId} AND id = ANY(${uniqueIds})
  `;
  const revById = new Map(revisionRows.map((r) => [r.id, r]));

  const fallbackIds: string[] = [];
  for (const id of uniqueIds) {
    const rev = revById.get(id);
    const parsed = rev
      ? parseRulesFromSourceDocument(rev.source_document, rev.source_path, id)
      : null;
    if (parsed) {
      result.set(id, parsed);
    } else {
      fallbackIds.push(id);
    }
  }

  if (fallbackIds.length > 0) {
    // Default every fallback revision to empty so revisions with no rows still
    // get an entry, then bucket the single query's rows by revision.
    for (const id of fallbackIds) result.set(id, []);
    const ruleRows = await sql<(PolicyRuleDbRow & { revision_id: string })[]>`
      SELECT revision_id, stable_rule_id, title, effect, source_path, domains, connectors, actions, immutable
      FROM policy_rule
      WHERE tenant_id = ${tenantId} AND revision_id = ANY(${fallbackIds})
      ORDER BY revision_id, stable_rule_id
    `;
    for (const row of ruleRows) {
      result.get(row.revision_id)?.push(mapPolicyRuleRow(row));
    }
  }

  return result;
}
