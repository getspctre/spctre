import { createHash } from "crypto";
import { sql } from "@/lib/db";
import type {
  AgtCompatibilityReport,
  PolicyArtifactExport,
  PolicyTimelineEvent,
  RuntimeStack,
  RuntimeTarget,
} from "@spctre/policy-schema";

export interface RevisionMetadata {
  branchId: string;
  revisionId: string;
  sourceFormat: PolicyArtifactExport["sourceFormat"];
  sourcePath?: string;
  sourceHash: string;
  sourceDocument?: Record<string, unknown>;
  compatibility?: AgtCompatibilityReport;
  targetStacks: RuntimeTarget[];
  publishedArtifactHash?: string;
}

export async function getRevisionMetadata(
  revisionId: string,
  tenantId: string
): Promise<RevisionMetadata | null> {
  if (!sql) return null;
  const rows = await sql<
    {
      branch_id: string;
      revision_id: string;
      source_format: string;
      source_path: string | null;
      source_hash: string;
      source_document: unknown;
      target_stacks: unknown;
      published_artifact_hash: string | null;
    }[]
  >`
    SELECT
      pr.branch_id,
      pr.id AS revision_id,
      pr.source_format,
      pr.source_path,
      pr.source_hash,
      pr.source_document,
      pr.target_stacks,
      (
        SELECT pp.artifact_hash
        FROM policy_publish pp
        WHERE pp.revision_id = pr.id
          AND pp.tenant_id = pr.tenant_id
        ORDER BY pp.published_at DESC
        LIMIT 1
      ) AS published_artifact_hash
    FROM policy_revision pr
    WHERE pr.tenant_id = ${tenantId} AND pr.id = ${revisionId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    branchId: row.branch_id,
    revisionId: row.revision_id,
    sourceFormat: row.source_format as PolicyArtifactExport["sourceFormat"],
    sourcePath: row.source_path ?? undefined,
    sourceHash: row.source_hash,
    sourceDocument:
      row.source_document && typeof row.source_document === "object" && !Array.isArray(row.source_document)
        ? (row.source_document as Record<string, unknown>)
        : undefined,
    compatibility: sourceCompatibilityFromJson(row.source_document),
    targetStacks: targetStacksFromJson(row.target_stacks),
    publishedArtifactHash: row.published_artifact_hash ?? undefined,
  };
}

function sourceCompatibilityFromJson(value: unknown): AgtCompatibilityReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const compatibility = (value as Record<string, unknown>).spctre_agt_compatibility;
  if (!compatibility || typeof compatibility !== "object" || Array.isArray(compatibility)) return undefined;
  return compatibility as AgtCompatibilityReport;
}

export async function getLatestRevisionMetadata(
  workspaceId: string | null,
  tenantId: string
): Promise<RevisionMetadata | null> {
  if (!sql) return null;
  const rows = await sql<{ revision_id: string }[]>`
    SELECT pr.id AS revision_id
    FROM policy_revision pr
    JOIN policy_branch pb ON pb.id = pr.branch_id AND pb.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ${tenantId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    ORDER BY pr.created_at DESC
    LIMIT 1
  `;
  return rows[0] ? getRevisionMetadata(rows[0].revision_id, tenantId) : null;
}

export async function revisionBelongsToWorkspace(
  revisionId: string,
  workspaceId: string | null,
  tenantId: string
): Promise<boolean> {
  if (!sql) return false;

  const rows = await sql<{ id: string }[]>`
    SELECT pr.id
    FROM policy_revision pr
    JOIN policy_branch pb ON pb.id = pr.branch_id AND pb.tenant_id = pr.tenant_id
    WHERE pr.tenant_id = ${tenantId}
      AND pr.id = ${revisionId}
      AND (pb.workspace_id = ${workspaceId} OR pb.scope = 'ORGANIZATION')
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function getBaseRevisionId(
  branchId: string,
  revisionId: string,
  tenantId: string
): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ base_revision_id: string | null }[]>`
    SELECT COALESCE(
      pr.parent_revision_id,
      (
        SELECT previous.id
        FROM policy_revision previous
        WHERE previous.branch_id = pr.branch_id
          AND previous.tenant_id = pr.tenant_id
          AND previous.created_at < pr.created_at
        ORDER BY previous.created_at DESC
        LIMIT 1
      )
    ) AS base_revision_id
    FROM policy_revision pr
    WHERE pr.tenant_id = ${tenantId}
      AND pr.branch_id = ${branchId}
      AND pr.id = ${revisionId}
    LIMIT 1
  `;

  return rows[0]?.base_revision_id ?? null;
}

export async function listApprovalTimelineEvents(
  branchId: string,
  revisionId: string,
  tenantId: string
): Promise<PolicyTimelineEvent[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      id: string;
      reviewer_id: string;
      reviewer_role: string;
      status: string;
      reviewed_at: Date | null;
      created_at: Date;
    }[]
  >`
    SELECT id, reviewer_id, reviewer_role, status, reviewed_at, created_at
    FROM policy_approval
    WHERE tenant_id = ${tenantId} AND revision_id = ${revisionId}
    ORDER BY COALESCE(reviewed_at, created_at) DESC
  `;

  return rows.map((row) => ({
    id: `approval-${row.id}`,
    kind: "APPROVAL" as const,
    branchId,
    revisionId,
    title: `${row.reviewer_role} review ${row.status.toLowerCase().replace("_", " ")}`,
    detail: `${row.reviewer_id} recorded ${row.status.toLowerCase().replace("_", " ")} for this revision.`,
    actor: row.reviewer_id,
    status: row.status,
    sourceId: row.id,
    createdAt: (row.reviewed_at ?? row.created_at).toISOString(),
  }));
}

export function stableHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

const VALID_RUNTIME_STACKS = new Set<RuntimeStack>([
  "AWS_BEDROCK", "GOOGLE_ADK", "AZURE_AI", "LANGCHAIN",
  "LANGGRAPH", "CREWAI", "AUTOGEN", "OPENAI_AGENTS",
  "OMNIGENT", "OPENCODE", "CLAUDE_CODE", "LOCAL", "CUSTOM",
]);

export function targetStacksFromJson(value: unknown): RuntimeTarget[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((target) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return [];
    }

    const stack = (target as { stack?: unknown }).stack;
    if (typeof stack !== "string" || !VALID_RUNTIME_STACKS.has(stack as RuntimeStack)) return [];

    return [
      {
        stack: stack as RuntimeStack,
        adapter:
          typeof (target as { adapter?: unknown }).adapter === "string"
            ? (target as { adapter: string }).adapter
            : undefined,
        environment:
          typeof (target as { environment?: unknown }).environment === "string"
            ? (target as { environment: string }).environment
            : undefined,
      }
    ];
  });
}
