import {
  POLICY_RULE_COLUMNS,
  toPolicyRuleRows,
  type PolicyRuleRow,
} from "@/lib/repositories/policy/rule-rows";
import { createHash } from "crypto";
import type { JSONValue } from "postgres";
import { assertCustomerRulesDoNotUseReservedIds } from "@/lib/policy/reserved-rule-ids";
import { sql } from "@/lib/db";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import type {
  AgtCompatibilityReport,
  PolicySourceTranslationReport,
  PolicyBranch,
  PolicyRuleSummary,
} from "@spctre/policy-schema";

export interface BranchRevision {
  revisionId: string;
  parentRevisionId: string | null;
  message: string;
  authorId: string;
  authorEmail: string | null;
  sourceFormat: string;
  sourceHash: string;
  packId?: string;
  packVersion?: string;
  ruleCount: number;
  isActive: boolean;
  publishedAt: string | null;
  createdAt: string;
}

/**
 * Row shape accepted by createCommittedRevision. Aliased to the shared
 * PolicyRuleRow so a column added there cannot be forgotten here.
 */
export type CommittedRuleRow = PolicyRuleRow;

export interface BranchStatusSummary {
  workspaceId: string;
  firstBranchId: string | null;
  hasInReview: boolean;
}

export async function listBranchStatusSummariesForTenant(
  tenantId: string,
): Promise<Map<string, BranchStatusSummary>> {
  if (!sql) return new Map();

  const rows = await sql<
    { workspace_id: string; branch_id: string; has_approvals: boolean; created_at: Date }[]
  >`
    WITH requested_workspace AS (
      SELECT id
      FROM workspace
      WHERE tenant_id = ${tenantId}
    )
    SELECT
      rw.id AS workspace_id,
      pb.id AS branch_id,
      EXISTS (
        SELECT 1
        FROM policy_approval pa
        WHERE pa.revision_id = pb.active_revision_id
          AND pa.tenant_id = pb.tenant_id
      ) AS has_approvals,
      pb.created_at
    FROM requested_workspace rw
    JOIN policy_branch pb
      ON pb.tenant_id = ${tenantId}
     AND (pb.workspace_id = rw.id OR pb.scope = 'ORGANIZATION')
    ORDER BY rw.id, pb.created_at DESC
  `;

  const summaries = new Map<string, BranchStatusSummary>();
  for (const row of rows) {
    const current = summaries.get(row.workspace_id);
    if (!current) {
      summaries.set(row.workspace_id, {
        workspaceId: row.workspace_id,
        firstBranchId: row.branch_id,
        hasInReview: row.has_approvals,
      });
      continue;
    }
    current.hasInReview ||= row.has_approvals;
  }
  return summaries;
}

export async function listBranches(
  workspaceId: string | null,
  tenantId: string,
): Promise<PolicyBranch[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      id: string;
      name: string;
      scope: string;
      environment: string | null;
      connector: string | null;
      active_revision_id: string | null;
      created_by: string;
      author_display_name: string | null;
      author_email: string | null;
      message: string | null;
      is_published: boolean;
      has_approvals: boolean;
    }[]
  >`
    SELECT
      pb.id, pb.name, pb.scope,
      pb.environment,
      pb.connector,
      pb.active_revision_id,
      pb.created_by,
      author.display_name AS author_display_name,
      author.email AS author_email,
      pr.message,
      (EXISTS (
        SELECT 1 FROM policy_publish pp
        WHERE pp.revision_id = pb.active_revision_id
          AND pp.tenant_id = pb.tenant_id
      )) AS is_published,
      (EXISTS (
        SELECT 1 FROM policy_approval pa
        WHERE pa.revision_id = pb.active_revision_id
          AND pa.tenant_id = pb.tenant_id
      )) AS has_approvals
    FROM policy_branch pb
    LEFT JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
    LEFT JOIN app_principal author ON author.id::text = pb.created_by AND author.tenant_id = pb.tenant_id
    WHERE pb.tenant_id = ${tenantId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    ORDER BY pb.created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope as PolicyBranch["scope"],
    environment: row.environment ?? undefined,
    connector: row.connector ?? undefined,
    activeRevision: row.active_revision_id ?? "",
    author: row.author_display_name ?? row.author_email ?? row.created_by,
    status: row.is_published ? "PUBLISHED" : row.has_approvals ? "IN_REVIEW" : ("DRAFT" as const),
    message: row.message ?? "",
  }));
}

export async function listBranchRevisions(
  branchId: string,
  workspaceId: string | null,
  tenantId: string,
): Promise<BranchRevision[]> {
  if (!sql) return [];

  const rows = await sql<
    {
      revision_id: string;
      parent_revision_id: string | null;
      message: string;
      author_id: string;
      author_email: string | null;
      source_format: string;
      source_hash: string;
      source_document: unknown;
      rule_count: number;
      is_active: boolean;
      published_at: Date | null;
      created_at: Date;
    }[]
  >`
    SELECT
      pr.id AS revision_id,
      pr.parent_revision_id,
      pr.message,
      pr.author_id,
      COALESCE(author.display_name, author.email) AS author_email,
      pr.source_format,
      pr.source_hash,
      pr.source_document,
      COUNT(rule.id)::int AS rule_count,
      (pr.id = pb.active_revision_id) AS is_active,
      (
        SELECT pp.published_at
        FROM policy_publish pp
        WHERE pp.revision_id = pr.id
          AND pp.tenant_id = pr.tenant_id
        ORDER BY pp.published_at DESC
        LIMIT 1
      ) AS published_at,
      pr.created_at
    FROM policy_revision pr
    JOIN policy_branch pb ON pb.id = pr.branch_id AND pb.tenant_id = pr.tenant_id
    LEFT JOIN policy_rule rule ON rule.revision_id = pr.id AND rule.tenant_id = pr.tenant_id
    LEFT JOIN app_principal author ON author.id::text = pr.author_id AND author.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ${tenantId}
      AND pr.branch_id = ${branchId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    GROUP BY
      pr.id, pr.parent_revision_id, pr.message, pr.author_id, author.display_name, author.email,
      pr.source_format, pr.source_hash, pr.source_document, pb.active_revision_id, pr.created_at
    ORDER BY pr.created_at DESC
  `;

  return rows.map((row) => {
    const sourceDocument =
      row.source_document &&
      typeof row.source_document === "object" &&
      !Array.isArray(row.source_document)
        ? (row.source_document as Record<string, unknown>)
        : {};
    const metadata =
      sourceDocument.metadata &&
      typeof sourceDocument.metadata === "object" &&
      !Array.isArray(sourceDocument.metadata)
        ? (sourceDocument.metadata as Record<string, unknown>)
        : {};
    const spctrePack =
      metadata.spctre_pack &&
      typeof metadata.spctre_pack === "object" &&
      !Array.isArray(metadata.spctre_pack)
        ? (metadata.spctre_pack as Record<string, unknown>)
        : {};

    return {
      revisionId: row.revision_id,
      parentRevisionId: row.parent_revision_id ?? null,
      message: row.message,
      authorId: row.author_id,
      authorEmail: row.author_email ?? null,
      sourceFormat: row.source_format,
      sourceHash: row.source_hash,
      packId: typeof spctrePack.packId === "string" ? spctrePack.packId : undefined,
      packVersion:
        typeof spctrePack.version === "string"
          ? spctrePack.version
          : typeof metadata.version === "string"
            ? metadata.version
            : undefined,
      ruleCount: row.rule_count,
      isActive: row.is_active,
      publishedAt: row.published_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function getBranchForRollback(params: {
  tenantId: string;
  branchId: string;
}): Promise<{ workspace_id: string | null; workspace_slug: string | null } | null> {
  if (!sql) return null;
  const rows = await sql<{ workspace_id: string | null; workspace_slug: string | null }[]>`
    SELECT pb.workspace_id, w.slug AS workspace_slug
    FROM policy_branch pb
    LEFT JOIN workspace w ON w.id = pb.workspace_id
    WHERE pb.tenant_id = ${params.tenantId}
      AND pb.id = ${params.branchId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getBranchWithPublishStatus(params: {
  tenantId: string;
  branchId: string;
}): Promise<{ id: string; name: string; has_published_revision: boolean } | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string; name: string; has_published_revision: boolean }[]>`
    SELECT
      pb.id,
      pb.name,
      (EXISTS (
        SELECT 1 FROM policy_publish pp
        INNER JOIN policy_revision pr ON pr.id = pp.revision_id
        WHERE pr.branch_id = pb.id
          AND pp.tenant_id = pb.tenant_id
      )) AS has_published_revision
    FROM policy_branch pb
    WHERE pb.id = ${params.branchId}
      AND pb.tenant_id = ${params.tenantId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function deletePolicyBranch(params: {
  tenantId: string;
  branchId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE policy_branch
    SET active_revision_id = NULL
    WHERE id = ${params.branchId} AND tenant_id = ${params.tenantId}
  `;
  await sql`DELETE FROM policy_publish WHERE branch_id = ${params.branchId} AND tenant_id = ${params.tenantId}`;
  await sql`DELETE FROM simulation_run WHERE branch_id = ${params.branchId} AND tenant_id = ${params.tenantId}`;
  await sql`
    DELETE FROM policy_branch
    WHERE id = ${params.branchId} AND tenant_id = ${params.tenantId}
  `;
}

export async function getPublishBranchScope(params: {
  tenantId: string;
  branchId: string;
}): Promise<{
  workspace_id: string | null;
  scope: string;
  environment: string | null;
  workspace_slug: string | null;
} | null> {
  if (!sql) return null;
  const rows = await sql<
    {
      workspace_id: string | null;
      scope: string;
      environment: string | null;
      workspace_slug: string | null;
    }[]
  >`
    SELECT pb.workspace_id, pb.scope, pb.environment, w.slug AS workspace_slug
    FROM policy_branch pb
    LEFT JOIN workspace w ON w.id = pb.workspace_id
    WHERE pb.id = ${params.branchId}
      AND pb.tenant_id = ${params.tenantId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function revisionExistsOnBranch(params: {
  tenantId: string;
  branchId: string;
  targetRevisionId: string;
  workspaceId: string | null;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM policy_revision
    WHERE tenant_id = ${params.tenantId}
      AND branch_id = ${params.branchId}
      AND id = ${params.targetRevisionId}
      AND (
        workspace_id = ${params.workspaceId}
        OR (${params.workspaceId}::uuid IS NULL AND workspace_id IS NULL)
      )
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function revisionExistsOnPublishBranch(params: {
  tenantId: string;
  branchId: string;
  revisionId: string;
  workspaceId: string | null;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM policy_revision
    WHERE tenant_id = ${params.tenantId}
      AND branch_id = ${params.branchId}
      AND id = ${params.revisionId}
      AND (
        workspace_id = ${params.workspaceId}
        OR (${params.workspaceId}::uuid IS NULL AND workspace_id IS NULL)
      )
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getRevisionWorkspaceScope(params: {
  tenantId: string;
  revisionId: string;
}): Promise<{ workspace_id: string | null; workspace_slug: string | null } | null> {
  if (!sql) return null;
  const rows = await sql<{ workspace_id: string | null; workspace_slug: string | null }[]>`
    SELECT pr.workspace_id, w.slug AS workspace_slug
    FROM policy_revision pr
    LEFT JOIN workspace w ON w.id = pr.workspace_id
    WHERE pr.id = ${params.revisionId}
      AND pr.tenant_id = ${params.tenantId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getRevisionAgeHours(
  revisionId: string,
  tenantId: string,
): Promise<number | null> {
  if (!sql || !revisionId) return null;
  const rows = await sql<{ age_hours: number }[]>`
    SELECT EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS age_hours
    FROM policy_revision
    WHERE tenant_id = ${tenantId}
      AND id = ${revisionId}
    LIMIT 1
  `;
  const value = rows[0]?.age_hours;
  return typeof value === "number" ? Math.round(value * 10) / 10 : null;
}

export async function getRevisionForDraft(params: {
  tenantId: string;
  branchId: string;
  revisionId: string;
}): Promise<{
  workspace_id: string | null;
  workspace_slug: string | null;
  source_format: string;
  source_path: string | null;
  source_document: unknown;
} | null> {
  if (!sql) return null;
  const rows = await sql<
    {
      workspace_id: string | null;
      workspace_slug: string | null;
      source_format: string;
      source_path: string | null;
      source_document: unknown;
    }[]
  >`
    SELECT pr.workspace_id, w.slug AS workspace_slug, pr.source_format, pr.source_path, pr.source_document
    FROM policy_revision pr
    LEFT JOIN workspace w ON w.id = pr.workspace_id
    WHERE pr.tenant_id = ${params.tenantId}
      AND pr.branch_id = ${params.branchId}
      AND pr.id = ${params.revisionId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function persistImportedBranch(params: {
  tenantId: string;
  authorId: string;
  branchName: string;
  scope: string;
  workspaceId: string;
  environment?: string;
  connector?: string;
  sourcePath: string;
  sourceFormat: string;
  source: string;
  rules: PolicyRuleSummary[];
  metadata: Record<string, unknown>;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
  translation?: PolicySourceTranslationReport;
  message: string;
  targetStacks?: string[];
}): Promise<{ branchId: string; revisionId: string; sourceHash: string; importedAt: string }> {
  if (!sql) throw new Error("Database not configured.");
  assertCustomerRulesDoNotUseReservedIds(params.rules);

  const sourceHash = `sha256:${createHash("sha256").update(params.source).digest("hex").slice(0, 16)}`;
  const branchId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const importedAt = new Date().toISOString();

  await ensureDemoTenant();

  if (params.scope !== "ORGANIZATION") {
    const workspaceRows = await sql<{ id: string }[]>`
      SELECT id FROM workspace
      WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId}
      LIMIT 1
    `;
    if (!workspaceRows.length)
      throw new Error("Workspace is not available in the selected tenant.");
  }

  await sql.begin(async (tx) => {
    const workspaceId = params.scope === "ORGANIZATION" ? null : params.workspaceId;
    await tx`
      INSERT INTO policy_branch (
        id, tenant_id, workspace_id, scope, environment, connector, name, created_by
      ) VALUES (
        ${branchId}, ${params.tenantId}, ${workspaceId},
        ${params.scope}, ${params.environment ?? null}, ${params.connector ?? null},
        ${params.branchName}, ${params.authorId}
      )
    `;
    const targetStacks = (params.targetStacks ?? []).map((stack) => ({ stack }));
    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id,
        source_format, source_path, source_document, source_hash,
        author_id, message, target_stacks
      ) VALUES (
        ${revisionId}, ${params.tenantId}, ${workspaceId}, ${branchId},
        ${params.sourceFormat}, ${params.sourcePath},
        ${tx.json({
          ...(params.sourceDocument ?? { rules: params.rules, metadata: params.metadata }),
          metadata: params.metadata,
          spctre_agt_compatibility: params.compatibility,
          spctre_native_source:
            params.sourceFormat === 'AGT_YAML'
              ? undefined
              : { text: params.source, translation: params.translation },
        } as JSONValue)},
        ${sourceHash}, ${params.authorId}, ${params.message},
        ${tx.json(targetStacks as JSONValue)}::jsonb
      )
    `;
    if (params.rules.length > 0) {
      const ruleRows = toPolicyRuleRows({
        tenantId: params.tenantId,
        workspaceId,
        branchId,
        revisionId,
        sourcePath: params.sourcePath,
        rules: params.rules,
      });
      await tx`INSERT INTO policy_rule ${tx(ruleRows, ...POLICY_RULE_COLUMNS)}`;
    }
    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${revisionId}
      WHERE id = ${branchId} AND tenant_id = ${params.tenantId}
    `;
  });

  return { branchId, revisionId, sourceHash, importedAt };
}

export interface ImportPolicyBranchResult {
  branchId: string;
  revisionId: string;
  sourceHash: string;
  importedAt: string;
  /** True when a brand-new branch was created (HTTP 201). */
  created: boolean;
  /** True when the branch head already carried this exact source (no write). */
  alreadyCurrent: boolean;
}

/**
 * Idempotent import for automation/CI. Unlike persistImportedBranch (which
 * always creates a fresh branch), this reuses a branch identified by
 * (tenant, workspace, scope, environment, connector, name):
 *
 *   - no such branch                          → create branch + revision
 *   - branch head source_hash == new hash     → no-op (alreadyCurrent)
 *   - branch head source_hash differs         → append a new draft revision
 *
 * Concurrency-safe: the lookup and the write run in ONE transaction guarded by
 * a per-identity advisory lock, so concurrent CI runs for the same branch
 * serialize — a racing importer blocks, then observes the committed branch and
 * appends (or no-ops) instead of creating a duplicate or appending from a stale
 * parent. The advisory lock is the authority here; the table's UNIQUE
 * constraint is NULLS-DISTINCT and so does not catch duplicate CONNECTOR /
 * WORKSPACE branches (environment/connector NULL). A bounded retry on a unique
 * violation covers the ENVIRONMENT-scoped case where the constraint does bite.
 *
 * An appended revision is an unapproved draft that becomes the branch head; it
 * never touches approval/publish state, so the currently published bundle is
 * unchanged until someone re-publishes. Never auto-approves or auto-publishes.
 */
export async function importPolicyBranchIdempotent(params: {
  tenantId: string;
  authorId: string;
  branchName: string;
  scope: string;
  workspaceId: string;
  environment?: string;
  connector?: string;
  sourcePath: string;
  sourceFormat: string;
  source: string;
  rules: PolicyRuleSummary[];
  metadata: Record<string, unknown>;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
  translation?: PolicySourceTranslationReport;
  message: string;
  targetStacks?: string[];
}): Promise<ImportPolicyBranchResult> {
  if (!sql) throw new Error("Database not configured.");
  const db = sql;
  assertCustomerRulesDoNotUseReservedIds(params.rules);

  const sourceHash = `sha256:${createHash("sha256").update(params.source).digest("hex").slice(0, 16)}`;
  const workspaceId = params.scope === "ORGANIZATION" ? null : params.workspaceId;
  const targetStacks = (params.targetStacks ?? []).map((stack) => ({ stack }));
  const sourceDocument = {
    ...(params.sourceDocument ?? { rules: params.rules, metadata: params.metadata }),
    metadata: params.metadata,
    spctre_agt_compatibility: params.compatibility,
    spctre_native_source:
      params.sourceFormat === "AGT_YAML"
        ? undefined
        : { text: params.source, translation: params.translation },
  };
  // Stable identity string matching the branch uniqueness columns; used to key
  // the advisory lock (0x1f unit separator keeps components unambiguous).
  const identity = [
    params.tenantId,
    workspaceId ?? "",
    params.scope,
    params.environment ?? "",
    params.connector ?? "",
    params.branchName,
  ].join("");

  await ensureDemoTenant();

  if (params.scope !== "ORGANIZATION") {
    const workspaceRows = await db<{ id: string }[]>`
      SELECT id FROM workspace
      WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId}
      LIMIT 1
    `;
    if (!workspaceRows.length)
      throw new Error("Workspace is not available in the selected tenant.");
  }

  const runOnce = () =>
    db.begin(async (tx): Promise<ImportPolicyBranchResult> => {
      // Serialize concurrent imports of the same branch identity. Held for the
      // life of the transaction; released on commit/rollback.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;

      const existing = await tx<
        { branch_id: string; active_revision_id: string | null; head_source_hash: string | null }[]
      >`
        SELECT
          pb.id AS branch_id,
          pb.active_revision_id,
          pr.source_hash AS head_source_hash
        FROM policy_branch pb
        LEFT JOIN policy_revision pr
          ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
        WHERE pb.tenant_id = ${params.tenantId}
          AND pb.name = ${params.branchName}
          AND pb.scope = ${params.scope}
          AND pb.workspace_id IS NOT DISTINCT FROM ${workspaceId}
          AND pb.connector IS NOT DISTINCT FROM ${params.connector ?? null}
          AND pb.environment IS NOT DISTINCT FROM ${params.environment ?? null}
        LIMIT 1
        FOR UPDATE OF pb
      `;

      const insertRevisionAndRules = async (
        branchId: string,
        revisionId: string,
        parentRevisionId: string | null,
      ) => {
        await tx`
          INSERT INTO policy_revision (
            id, tenant_id, workspace_id, branch_id, parent_revision_id,
            source_format, source_path, source_document, source_hash,
            author_id, message, target_stacks
          ) VALUES (
            ${revisionId}, ${params.tenantId}, ${workspaceId}, ${branchId}, ${parentRevisionId},
            ${params.sourceFormat}, ${params.sourcePath}, ${tx.json(sourceDocument as JSONValue)},
            ${sourceHash}, ${params.authorId}, ${params.message}, ${tx.json(targetStacks as JSONValue)}::jsonb
          )
        `;
        if (params.rules.length > 0) {
          const ruleRows = toPolicyRuleRows({
            tenantId: params.tenantId,
            workspaceId,
            branchId,
            revisionId,
            sourcePath: params.sourcePath,
            rules: params.rules,
          });
          await tx`INSERT INTO policy_rule ${tx(ruleRows, ...POLICY_RULE_COLUMNS)}`;
        }
        await tx`
          UPDATE policy_branch SET active_revision_id = ${revisionId}
          WHERE id = ${branchId} AND tenant_id = ${params.tenantId}
        `;
      };

      const importedAt = new Date().toISOString();

      // No existing branch: create branch + first revision.
      if (!existing.length) {
        const branchId = crypto.randomUUID();
        const revisionId = crypto.randomUUID();
        await tx`
          INSERT INTO policy_branch (
            id, tenant_id, workspace_id, scope, environment, connector, name, created_by
          ) VALUES (
            ${branchId}, ${params.tenantId}, ${workspaceId},
            ${params.scope}, ${params.environment ?? null}, ${params.connector ?? null},
            ${params.branchName}, ${params.authorId}
          )
        `;
        await insertRevisionAndRules(branchId, revisionId, null);
        return {
          branchId,
          revisionId,
          sourceHash,
          importedAt,
          created: true,
          alreadyCurrent: false,
        };
      }

      const branchId = existing[0].branch_id;
      const currentRevisionId = existing[0].active_revision_id;

      // Head already carries this exact source: no write.
      if (existing[0].head_source_hash === sourceHash) {
        return {
          branchId,
          revisionId: currentRevisionId ?? "",
          sourceHash,
          importedAt,
          created: false,
          alreadyCurrent: true,
        };
      }

      // Source changed: append a new draft revision and move the branch head.
      const revisionId = crypto.randomUUID();
      await insertRevisionAndRules(branchId, revisionId, currentRevisionId);
      return {
        branchId,
        revisionId,
        sourceHash,
        importedAt,
        created: false,
        alreadyCurrent: false,
      };
    });

  // The advisory lock serializes same-identity imports, so a unique violation
  // is not expected — but retry a bounded number of times as defense in depth
  // (e.g. an ENVIRONMENT-scoped identity racing a non-idempotent creator).
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await runOnce();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "23505" && attempt < 2) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Policy import failed after contention retries.");
}

export async function createDraftRevision(params: {
  tenantId: string;
  draftRevisionId: string;
  branchId: string;
  baseRevisionId: string;
  baseWorkspaceId: string | null;
  sourceFormat: string;
  sourcePath: string;
  sourceDocument: Record<string, unknown>;
  sourceHash: string;
  actorId: string;
  message: string;
}): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id, parent_revision_id,
        source_format, source_path, source_document, source_hash,
        author_id, message
      ) VALUES (
        ${params.draftRevisionId}, ${params.tenantId}, ${params.baseWorkspaceId}, ${params.branchId}, ${params.baseRevisionId},
        ${params.sourceFormat}, ${params.sourcePath},
        ${sql.json(params.sourceDocument as JSONValue)}, ${params.sourceHash},
        ${params.actorId}, ${params.message}
      )
    `;
    await tx`
      INSERT INTO policy_rule (
        tenant_id, workspace_id, branch_id, revision_id,
        stable_rule_id, title, effect, source_path,
        domains, connectors, actions, immutable,
        semantic_checks, parameter_constraints
      )
      SELECT
        tenant_id, workspace_id, branch_id, ${params.draftRevisionId},
        stable_rule_id, title, effect, source_path,
        domains, connectors, actions, immutable,
        semantic_checks, parameter_constraints
      FROM policy_rule
      WHERE tenant_id = ${params.tenantId} AND revision_id = ${params.baseRevisionId}
    `;
    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${params.draftRevisionId}
      WHERE tenant_id = ${params.tenantId} AND id = ${params.branchId}
    `;
  });
}

export async function createCommittedRevision(params: {
  tenantId: string;
  revisionId: string;
  branchId: string;
  branchWorkspaceId: string | null;
  parentRevisionId: string;
  sourcePath: string;
  sourceDocument: Record<string, unknown>;
  sourceHash: string;
  actorId: string;
  message: string;
  rules: CommittedRuleRow[];
}): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  assertCustomerRulesDoNotUseReservedIds(
    params.rules.map((rule) => ({ stableRuleId: rule.stable_rule_id })),
  );
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id, parent_revision_id,
        source_format, source_path, source_document, source_hash,
        author_id, message
      ) VALUES (
        ${params.revisionId}, ${params.tenantId}, ${params.branchWorkspaceId}, ${params.branchId}, ${params.parentRevisionId},
        'AGT_YAML', ${params.sourcePath}, ${sql.json(params.sourceDocument as JSONValue)}, ${params.sourceHash},
        ${params.actorId}, ${params.message}
      )
    `;
    await tx`INSERT INTO policy_rule ${tx(params.rules, ...POLICY_RULE_COLUMNS)}`;
    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${params.revisionId}
      WHERE tenant_id = ${params.tenantId} AND id = ${params.branchId}
    `;
    await tx`
      DELETE FROM policy_approval
      WHERE tenant_id = ${params.tenantId} AND revision_id = ${params.parentRevisionId}
    `;
  });
}
