import { sql, rawSql } from "@/lib/db";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import { getPackVersion, POLICY_PACKS } from "@spctre/policy-schema/packs";
import type { AdapterCapabilityDeclaration, AgtCompatibilityReport, PolicyRuleSummary, RuntimeStack } from "@spctre/policy-schema";
import {
  listRulesForRevision as listRulesForRevisionShared,
  listRulesForRevisions as listRulesForRevisionsShared,
} from "@/lib/repositories/shared/rules";

export type { AdapterCapabilityDeclaration } from "@spctre/policy-schema";

export interface PackInstallStatus {
  branchId: string;
  branchName: string;
  connector: string;
  revisionId: string;
  installedAt: string;
  installedVersion: string;
  packId?: string;
  hasCustomizations: boolean;
}

export async function listPackInstallStatuses(
  workspaceId: string | null,
  tenantId: string
): Promise<PackInstallStatus[]> {
  if (!sql) return [];

  const rows = await sql<
    {
      branch_id: string;
      branch_name: string;
      connector: string;
      revision_id: string;
      created_at: Date;
      message: string;
      source_document: unknown;
      has_customizations: boolean;
    }[]
  >`
    SELECT
      pb.id AS branch_id,
      pb.name AS branch_name,
      pb.connector,
      pr.id AS revision_id,
      pr.created_at,
      pr.message,
      pr.source_document,
      EXISTS (
        SELECT 1
        FROM policy_revision pr_custom
        WHERE pr_custom.tenant_id = pb.tenant_id
          AND pr_custom.branch_id = pb.id
          AND COALESCE(pr_custom.source_document->'metadata'->>'authoredInApp', 'false') = 'true'
      ) AS has_customizations
    FROM policy_branch pb
    JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
    WHERE pb.tenant_id = ${tenantId}
      AND pb.scope = 'CONNECTOR'
      AND pb.connector IS NOT NULL
      AND pb.workspace_id = ${workspaceId}
    ORDER BY pb.created_at DESC
  `;

  function parseVersion(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  }

  function parseVersionFromMessage(message: string): string | null {
    const byTo = message.match(/to\s+v?(\d+\.\d+\.\d+)/i);
    if (byTo?.[1]) return byTo[1];
    const generic = message.match(/v(\d+\.\d+\.\d+)/i);
    return generic?.[1] ?? null;
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  return rows.map((row) => {
    const sourceDocument = asRecord(row.source_document);
    const metadata = asRecord(sourceDocument.metadata);
    const spctrePack = asRecord(metadata.spctre_pack);
    const topLevelSpctrePack = asRecord(sourceDocument.spctre_pack);
    const camelCaseSpctrePack = asRecord(metadata.spctrePack);

    const packId =
      typeof spctrePack.packId === "string"
        ? spctrePack.packId
        : typeof topLevelSpctrePack.packId === "string"
          ? topLevelSpctrePack.packId
          : undefined;

    const catalogPack = POLICY_PACKS.find(
      (pack) => (packId && pack.id === packId) || pack.connector === row.connector
    );

    const installedVersion =
      parseVersion(spctrePack.version) ??
      parseVersion(topLevelSpctrePack.version) ??
      parseVersion(camelCaseSpctrePack.version) ??
      parseVersion(metadata.version) ??
      parseVersion(sourceDocument.version) ??
      parseVersionFromMessage(row.message) ??
      (catalogPack ? getPackVersion(catalogPack) : "1.0.0");

    return {
      branchId: row.branch_id,
      branchName: row.branch_name,
      connector: row.connector,
      revisionId: row.revision_id,
      installedAt: row.created_at.toISOString(),
      installedVersion,
      packId,
      hasCustomizations: row.has_customizations,
    };
  });
}

export async function listAdapterDeclarations(
  workspaceId: string | null,
  tenantId: string,
  environment?: string
): Promise<AdapterCapabilityDeclaration[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      id: string;
      stack: string;
      adapter_id: string;
      adapter_version: string | null;
      environment: string | null;
      supported_connectors: string[];
      capabilities: unknown;
      registered_at: Date;
      registered_by: string;
    }[]
  >`
    SELECT id, stack, adapter_id, adapter_version, environment,
           supported_connectors, capabilities, registered_at, registered_by
    FROM runtime_adapter_declaration
    WHERE tenant_id = ${tenantId}
      AND (workspace_id = ${workspaceId} OR workspace_id IS NULL)
      ${environment ? rawSql`AND (environment = ${environment} OR environment IS NULL)` : rawSql``}
    ORDER BY registered_at DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    stack: row.stack as RuntimeStack,
    adapterId: row.adapter_id,
    adapterVersion: row.adapter_version ?? undefined,
    environment: row.environment ?? undefined,
    supportedConnectors: row.supported_connectors ?? [],
    capabilities:
      row.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities)
        ? (row.capabilities as Record<string, unknown>)
        : {},
    registeredAt: row.registered_at.toISOString(),
    registeredBy: row.registered_by,
  }));
}

export async function findConnectorBranch(params: {
  tenantId: string;
  workspaceId: string;
  connector: string;
}): Promise<{ id: string; active_revision_id: string | null } | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string; active_revision_id: string | null }[]>`
    SELECT id, active_revision_id
    FROM policy_branch
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND scope = 'CONNECTOR'
      AND connector = ${params.connector}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listRulesForRevision(params: {
  tenantId: string;
  revisionId: string | null;
}): Promise<PolicyRuleSummary[]> {
  if (!params.revisionId) return [];
  return listRulesForRevisionShared(params.revisionId, params.tenantId);
}

export async function listRulesForRevisions(params: {
  tenantId: string;
  revisionIds: string[];
}): Promise<Map<string, PolicyRuleSummary[]>> {
  return listRulesForRevisionsShared(params.revisionIds, params.tenantId);
}

export async function persistPackInstallBranch(params: {
  tenantId: string;
  authorId: string;
  branchName: string;
  workspaceId: string;
  connector: string;
  sourcePath: string;
  source: string;
  rules: PolicyRuleSummary[];
  metadata: Record<string, unknown>;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
  message: string;
}): Promise<{ branchId: string; revisionId: string; sourceHash: string; importedAt: string }> {
  if (!sql) throw new Error("Database not configured.");

  const { createHash } = await import("crypto");
  const sourceHash = `sha256:${createHash("sha256").update(params.source).digest("hex").slice(0, 16)}`;
  const branchId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const importedAt = new Date().toISOString();

  await ensureDemoTenant();

  const workspaceRows = await sql<{ id: string }[]>`
    SELECT id FROM workspace
    WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId}
    LIMIT 1
  `;
  if (!workspaceRows.length) throw new Error("Workspace is not available in the selected tenant.");

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_branch (
        id, tenant_id, workspace_id, scope, environment, connector, name, created_by
      ) VALUES (
        ${branchId}, ${params.tenantId}, ${params.workspaceId},
        'CONNECTOR', null, ${params.connector}, ${params.branchName}, ${params.authorId}
      )
    `;
    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id,
        source_format, source_path, source_document, source_hash,
        author_id, message, target_stacks
      ) VALUES (
        ${revisionId}, ${params.tenantId}, ${params.workspaceId}, ${branchId},
        'AGT_YAML', ${params.sourcePath},
        ${JSON.stringify({
          ...(params.sourceDocument ?? { rules: params.rules, metadata: params.metadata }),
          metadata: params.metadata,
          spctre_agt_compatibility: params.compatibility,
        })},
        ${sourceHash}, ${params.authorId}, ${params.message},
        '[]'::jsonb
      )
    `;
    if (params.rules.length > 0) {
      const ruleRows = params.rules.map((rule) => ({
        tenant_id: params.tenantId,
        workspace_id: params.workspaceId,
        branch_id: branchId,
        revision_id: revisionId,
        stable_rule_id: rule.stableRuleId,
        title: rule.title,
        effect: rule.effect,
        source_path: rule.sourcePath ?? params.sourcePath,
        domains: rule.domains ?? [],
        connectors: rule.connectors ?? [],
        actions: rule.actions ?? [],
        immutable: rule.immutable ?? false,
      }));
      await tx`INSERT INTO policy_rule ${tx(ruleRows, "tenant_id", "workspace_id", "branch_id", "revision_id", "stable_rule_id", "title", "effect", "source_path", "domains", "connectors", "actions", "immutable")}`;
    }
    await tx`UPDATE policy_branch SET active_revision_id = ${revisionId} WHERE id = ${branchId}`;
  });

  return { branchId, revisionId, sourceHash, importedAt };
}

export async function persistPackUpgradeRevision(params: {
  tenantId: string;
  authorId: string;
  workspaceId: string;
  branchId: string;
  parentRevisionId?: string;
  sourcePath: string;
  source: string;
  rules: PolicyRuleSummary[];
  metadata: Record<string, unknown>;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
  message: string;
}): Promise<{ revisionId: string; sourceHash: string; importedAt: string }> {
  if (!sql) throw new Error("Database not configured.");

  const { createHash } = await import("crypto");
  const sourceHash = `sha256:${createHash("sha256").update(params.source).digest("hex").slice(0, 16)}`;
  const revisionId = crypto.randomUUID();
  const importedAt = new Date().toISOString();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id, parent_revision_id,
        source_format, source_path, source_document, source_hash,
        author_id, message, target_stacks
      ) VALUES (
        ${revisionId}, ${params.tenantId}, ${params.workspaceId}, ${params.branchId}, ${params.parentRevisionId ?? null},
        'AGT_YAML', ${params.sourcePath},
        ${JSON.stringify({
          ...(params.sourceDocument ?? { rules: params.rules, metadata: params.metadata }),
          metadata: params.metadata,
          spctre_agt_compatibility: params.compatibility,
        })},
        ${sourceHash}, ${params.authorId}, ${params.message},
        '[]'::jsonb
      )
    `;
    if (params.rules.length > 0) {
      const ruleRows = params.rules.map((rule) => ({
        tenant_id: params.tenantId,
        workspace_id: params.workspaceId,
        branch_id: params.branchId,
        revision_id: revisionId,
        stable_rule_id: rule.stableRuleId,
        title: rule.title,
        effect: rule.effect,
        source_path: rule.sourcePath ?? params.sourcePath,
        domains: rule.domains ?? [],
        connectors: rule.connectors ?? [],
        actions: rule.actions ?? [],
        immutable: rule.immutable ?? false,
      }));
      await tx`INSERT INTO policy_rule ${tx(ruleRows, "tenant_id", "workspace_id", "branch_id", "revision_id", "stable_rule_id", "title", "effect", "source_path", "domains", "connectors", "actions", "immutable")}`;
    }
    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${revisionId}
      WHERE id = ${params.branchId} AND tenant_id = ${params.tenantId}
    `;
  });

  return { revisionId, sourceHash, importedAt };
}

export async function upsertAdapterDeclaration(
  declaration: Omit<AdapterCapabilityDeclaration, "id" | "registeredAt">,
  workspaceId: string | null,
  tenantId: string
): Promise<string> {
  if (!sql) throw new Error("Database not configured.");
  await ensureDemoTenant();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO runtime_adapter_declaration (
      tenant_id, workspace_id, environment, stack, adapter_id, adapter_version,
      supported_connectors, capabilities, registered_by
    ) VALUES (
      ${tenantId}, ${workspaceId}, ${declaration.environment ?? null},
      ${declaration.stack}, ${declaration.adapterId}, ${declaration.adapterVersion ?? null},
      ${declaration.supportedConnectors}, ${JSON.stringify(declaration.capabilities)}::jsonb,
      ${declaration.registeredBy}
    )
    ON CONFLICT (tenant_id, workspace_id, environment, stack, adapter_id) DO UPDATE SET
      adapter_version       = EXCLUDED.adapter_version,
      supported_connectors  = EXCLUDED.supported_connectors,
      capabilities          = EXCLUDED.capabilities,
      registered_by         = EXCLUDED.registered_by,
      registered_at         = NOW()
    RETURNING id
  `;
  return rows[0].id;
}
