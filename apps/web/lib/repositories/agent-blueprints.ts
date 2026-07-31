import { createHash } from "crypto";
import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";
import type {
  AgentBlueprintDefinition,
  AgentBlueprintRevision,
  AgentBlueprintStatus,
  AgentBlueprintSummary,
  RuntimeBlueprintContext,
  PolicyApproval,
} from "@spctre/policy-schema";

type BlueprintRow = {
  id: string;
  name: string;
  agent_id: string;
  workspace_id: string;
  active_revision_id: string | null;
  status: string | null;
  policy_branch_id: string | null;
  policy_revision_id: string | null;
  updated_at: Date;
};

type RevisionRow = {
  id: string;
  blueprint_id: string;
  parent_revision_id: string | null;
  definition: unknown;
  definition_hash: string;
  message: string;
  author_id: string;
  status: string;
  created_at: Date;
  published_at: Date | null;
};

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => [JSON.stringify(key), canonicalize(record[key])].join(":")).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashBlueprintDefinition(definition: AgentBlueprintDefinition): string {
  return createHash("sha256").update(canonicalize(definition)).digest("hex");
}

function mapSummary(row: BlueprintRow): AgentBlueprintSummary {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    activeRevisionId: row.active_revision_id ?? "",
    status: (row.status ?? "DRAFT") as AgentBlueprintStatus,
    policyBranchId: row.policy_branch_id ?? undefined,
    policyRevisionId: row.policy_revision_id ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRevision(row: RevisionRow): AgentBlueprintRevision {
  return {
    id: row.id,
    blueprintId: row.blueprint_id,
    parentRevisionId: row.parent_revision_id ?? undefined,
    definition: row.definition as AgentBlueprintDefinition,
    definitionHash: row.definition_hash,
    message: row.message,
    authorId: row.author_id,
    status: row.status as AgentBlueprintStatus,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString(),
  };
}

export async function listAgentBlueprints(params: { tenantId: string; workspaceId: string }): Promise<AgentBlueprintSummary[]> {
  if (!sql) return [];
  const rows = await sql<BlueprintRow[]>`
    SELECT b.id, b.name, b.agent_id, b.workspace_id, b.active_revision_id, b.updated_at,
      r.status, r.definition->>'policyBranchId' AS policy_branch_id,
      r.definition->>'policyRevisionId' AS policy_revision_id
    FROM agent_blueprint b
    LEFT JOIN agent_blueprint_revision r ON r.id = b.active_revision_id AND r.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${params.tenantId} AND b.workspace_id = ${params.workspaceId}
    ORDER BY b.updated_at DESC
  `;
  return rows.map(mapSummary);
}

export async function getAgentBlueprint(params: { tenantId: string; workspaceId: string; blueprintId: string }): Promise<{ blueprint: AgentBlueprintSummary; revisions: AgentBlueprintRevision[] } | null> {
  if (!sql) return null;
  const blueprints = await sql<BlueprintRow[]>`
    SELECT b.id, b.name, b.agent_id, b.workspace_id, b.active_revision_id, b.updated_at,
      r.status, r.definition->>'policyBranchId' AS policy_branch_id,
      r.definition->>'policyRevisionId' AS policy_revision_id
    FROM agent_blueprint b
    LEFT JOIN agent_blueprint_revision r ON r.id = b.active_revision_id AND r.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${params.tenantId} AND b.workspace_id = ${params.workspaceId} AND b.id = ${params.blueprintId}
  `;
  const blueprint = blueprints[0];
  if (!blueprint) return null;
  const revisions = await sql<RevisionRow[]>`
    SELECT id, blueprint_id, parent_revision_id, definition, definition_hash, message, author_id, status, created_at, published_at
    FROM agent_blueprint_revision
    WHERE tenant_id = ${params.tenantId} AND blueprint_id = ${params.blueprintId}
    ORDER BY created_at DESC
  `;
  return { blueprint: mapSummary(blueprint), revisions: revisions.map(mapRevision) };
}

export async function getPublishedBlueprintContext(params: {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  policyRevisionIds: string[];
}): Promise<RuntimeBlueprintContext | undefined> {
  if (!sql) return undefined;
  const rows = await sql<{
    blueprint_id: string;
    revision_id: string;
    definition_hash: string;
    name: string;
  }[]>`
    SELECT b.id AS blueprint_id, r.id AS revision_id, r.definition_hash, b.name
    FROM agent_blueprint b
    JOIN LATERAL (
      SELECT id, definition_hash
      FROM agent_blueprint_revision
      WHERE tenant_id = b.tenant_id
        AND blueprint_id = b.id
        AND status = 'PUBLISHED'
        AND (
          definition->>'policyRevisionId' IS NULL
          OR definition->>'policyRevisionId' = ANY(${params.policyRevisionIds})
        )
      ORDER BY published_at DESC, created_at DESC
      LIMIT 1
    ) r ON TRUE
    WHERE b.tenant_id = ${params.tenantId}
      AND b.workspace_id = ${params.workspaceId}
      AND b.agent_id = ${params.agentId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? {
    blueprintId: row.blueprint_id,
    revisionId: row.revision_id,
    definitionHash: row.definition_hash,
    name: row.name,
  } : undefined;
}

export async function getPublishedAgentBlueprintRuntime(params: {
  tenantId: string;
  workspaceId: string;
  blueprintId: string;
}): Promise<{ name: string; revision: AgentBlueprintRevision; policyArtifactHash?: string } | null> {
  if (!sql) return null;
  const rows = await sql<(RevisionRow & { name: string; policy_artifact_hash: string | null })[]>`
    SELECT r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash,
      r.message, r.author_id, r.status, r.created_at, r.published_at, b.name,
      pp.artifact_hash AS policy_artifact_hash
    FROM agent_blueprint b
    JOIN agent_blueprint_revision r ON r.blueprint_id = b.id AND r.tenant_id = b.tenant_id
    LEFT JOIN policy_publish pp
      ON pp.tenant_id = b.tenant_id
      AND pp.revision_id = r.definition->>'policyRevisionId'
    WHERE b.tenant_id = ${params.tenantId}
      AND b.workspace_id = ${params.workspaceId}
      AND b.id = ${params.blueprintId}
      AND r.status = 'PUBLISHED'
    ORDER BY r.published_at DESC, r.created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { name: row.name, revision: mapRevision(row), policyArtifactHash: row.policy_artifact_hash ?? undefined } : null;
}

export async function getPublishedAgentBlueprintRuntimeByAgent(params: {
  tenantId: string; workspaceId: string; agentId: string;
}): Promise<{ name: string; revision: AgentBlueprintRevision; policyArtifactHash?: string } | null> {
  if (!sql) return null;
  const rows = await sql<(RevisionRow & { name: string; policy_artifact_hash: string | null })[]>`
    SELECT r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash, r.message, r.author_id, r.status, r.created_at, r.published_at, b.name,
      pp.artifact_hash AS policy_artifact_hash
    FROM agent_blueprint b JOIN agent_blueprint_revision r ON r.blueprint_id = b.id AND r.tenant_id = b.tenant_id
    LEFT JOIN policy_publish pp ON pp.tenant_id = b.tenant_id AND pp.revision_id = r.definition->>'policyRevisionId'
    WHERE b.tenant_id = ${params.tenantId} AND b.workspace_id = ${params.workspaceId} AND b.agent_id = ${params.agentId} AND r.status = 'PUBLISHED'
    ORDER BY r.published_at DESC, r.created_at DESC LIMIT 1
  `;
  const row = rows[0]; return row ? { name: row.name, revision: mapRevision(row), policyArtifactHash: row.policy_artifact_hash ?? undefined } : null;
}

export async function getPublishedBlueprintForGateway(params: { tenantId: string; workspaceId: string; agentId: string; policyRevisionIds: string[] }): Promise<AgentBlueprintRevision | null> {
  if (!sql) return null;
  const rows = await sql<RevisionRow[]>`
    SELECT r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash, r.message, r.author_id, r.status, r.created_at, r.published_at
    FROM agent_blueprint b
    JOIN agent_blueprint_revision r ON r.blueprint_id = b.id AND r.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${params.tenantId} AND b.workspace_id = ${params.workspaceId} AND b.agent_id = ${params.agentId}
      AND r.status = 'PUBLISHED'
      AND (r.definition->>'policyRevisionId' IS NULL OR r.definition->>'policyRevisionId' = ANY(${params.policyRevisionIds}))
    ORDER BY r.published_at DESC, r.created_at DESC LIMIT 1
  `;
  return rows[0] ? mapRevision(rows[0]) : null;
}

export async function createAgentBlueprint(params: {
  tenantId: string; workspaceId: string; name: string; agentId: string; authorId: string; message: string; definition: AgentBlueprintDefinition;
}): Promise<AgentBlueprintSummary | null> {
  if (!sql) return null;
  const definitionHash = hashBlueprintDefinition(params.definition);
  const rows = await sql<BlueprintRow[]>`
    WITH blueprint AS (
      INSERT INTO agent_blueprint (tenant_id, workspace_id, name, agent_id, created_by)
      VALUES (${params.tenantId}, ${params.workspaceId}, ${params.name}, ${params.agentId}, ${params.authorId})
      RETURNING id
    ), revision AS (
      INSERT INTO agent_blueprint_revision (tenant_id, blueprint_id, definition, definition_hash, message, author_id)
      SELECT ${params.tenantId}, id, ${sql.json(params.definition as unknown as JSONValue)}::jsonb, ${definitionHash}, ${params.message}, ${params.authorId}
      FROM blueprint RETURNING id, blueprint_id
    )
    UPDATE agent_blueprint b SET active_revision_id = revision.id, updated_at = now()
    FROM revision WHERE b.id = revision.blueprint_id
    RETURNING b.id, b.name, b.agent_id, b.workspace_id, b.active_revision_id, b.updated_at,
      'DRAFT'::text AS status, NULL::text AS policy_branch_id, NULL::text AS policy_revision_id
  `;
  return rows[0] ? mapSummary(rows[0]) : null;
}

export async function createAgentBlueprintRevision(params: {
  tenantId: string; workspaceId: string; blueprintId: string; authorId: string; message: string; definition: AgentBlueprintDefinition;
}): Promise<AgentBlueprintRevision | null> {
  if (!sql) return null;
  const definitionHash = hashBlueprintDefinition(params.definition);
  const rows = await sql<RevisionRow[]>`
    WITH parent AS (
      SELECT active_revision_id FROM agent_blueprint
      WHERE id = ${params.blueprintId} AND tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
    ), revision AS (
      INSERT INTO agent_blueprint_revision (tenant_id, blueprint_id, parent_revision_id, definition, definition_hash, message, author_id)
      SELECT ${params.tenantId}, ${params.blueprintId}, active_revision_id,
        ${sql.json(params.definition as unknown as JSONValue)}::jsonb, ${definitionHash}, ${params.message}, ${params.authorId}
      FROM parent
      RETURNING id, blueprint_id, parent_revision_id, definition, definition_hash, message, author_id, status, created_at, published_at
    )
    UPDATE agent_blueprint b SET active_revision_id = revision.id, updated_at = now()
    FROM revision WHERE b.id = revision.blueprint_id
    RETURNING revision.id, revision.blueprint_id, revision.parent_revision_id, revision.definition,
      revision.definition_hash, revision.message, revision.author_id, revision.status, revision.created_at, revision.published_at
  `;
  return rows[0] ? mapRevision(rows[0]) : null;
}

export async function getAgentBlueprintApprovals(params: { tenantId: string; revisionId: string }): Promise<PolicyApproval[]> {
  if (!sql) return [];
  const rows = await sql<{ reviewer_id: string; reviewer_role: string; status: PolicyApproval["status"]; reviewed_at: Date | null }[]>`
    SELECT reviewer_id, reviewer_role, status, reviewed_at
    FROM agent_blueprint_approval
    WHERE tenant_id = ${params.tenantId} AND revision_id = ${params.revisionId}
    ORDER BY reviewed_at DESC
  `;
  return rows.map((row) => ({ reviewer: row.reviewer_id, role: row.reviewer_role, status: row.status, reviewedAt: row.reviewed_at?.toISOString() }));
}

export async function upsertAgentBlueprintApproval(params: {
  tenantId: string; workspaceId: string; blueprintId: string; revisionId: string; reviewerId: string; reviewerRole: string; status: PolicyApproval["status"]; note?: string | null;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO agent_blueprint_approval (tenant_id, workspace_id, blueprint_id, revision_id, reviewer_id, reviewer_role, status, note)
    SELECT ${params.tenantId}, ${params.workspaceId}, ${params.blueprintId}, ${params.revisionId}, ${params.reviewerId}, ${params.reviewerRole}, ${params.status}, ${params.note ?? null}
    WHERE EXISTS (SELECT 1 FROM agent_blueprint_revision WHERE id = ${params.revisionId} AND blueprint_id = ${params.blueprintId} AND tenant_id = ${params.tenantId})
    ON CONFLICT (revision_id, reviewer_id) DO UPDATE SET reviewer_role = EXCLUDED.reviewer_role, status = EXCLUDED.status, note = EXCLUDED.note, reviewed_at = now()
    RETURNING id
  `;
  return rows.length > 0;
}

export async function setAgentBlueprintRevisionStatus(params: {
  tenantId: string; workspaceId: string; blueprintId: string; revisionId: string; status: AgentBlueprintStatus;
}): Promise<AgentBlueprintRevision | null> {
  if (!sql) return null;
  if (params.status === "DRAFT") return null;
  const expectedCurrentStatus = params.status === "IN_REVIEW" ? "DRAFT" : "IN_REVIEW";
  const rows = await sql<RevisionRow[]>`
    UPDATE agent_blueprint_revision r SET status = ${params.status}, published_at = CASE WHEN ${params.status} = 'PUBLISHED' THEN now() ELSE published_at END
    FROM agent_blueprint b
    WHERE r.id = ${params.revisionId} AND r.blueprint_id = ${params.blueprintId}
      AND b.id = r.blueprint_id AND b.tenant_id = ${params.tenantId} AND b.workspace_id = ${params.workspaceId}
      AND r.status = ${expectedCurrentStatus}
      AND (
        ${params.status} <> 'PUBLISHED'
        OR r.definition->>'policyRevisionId' IS NULL
        OR EXISTS (
          SELECT 1 FROM policy_publish pp
          WHERE pp.tenant_id = b.tenant_id
            AND pp.revision_id = r.definition->>'policyRevisionId'
        )
      )
    RETURNING r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash, r.message, r.author_id, r.status, r.created_at, r.published_at
  `;
  return rows[0] ? mapRevision(rows[0]) : null;
}

export async function rollbackAgentBlueprint(params: {
  tenantId: string;
  workspaceId: string;
  blueprintId: string;
  targetRevisionId: string;
}): Promise<AgentBlueprintRevision | null> {
  if (!sql) return null;
  const rows = await sql<RevisionRow[]>`
    WITH target AS (
      SELECT r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash,
        r.message, r.author_id, r.status, r.created_at, r.published_at
      FROM agent_blueprint_revision r
      JOIN agent_blueprint b ON b.id = r.blueprint_id AND b.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${params.tenantId}
        AND b.workspace_id = ${params.workspaceId}
        AND r.blueprint_id = ${params.blueprintId}
        AND r.id = ${params.targetRevisionId}
        AND r.status = 'PUBLISHED'
    ), activated AS (
      UPDATE agent_blueprint b
      SET active_revision_id = target.id, updated_at = now()
      FROM target
      WHERE b.id = target.blueprint_id
      RETURNING b.id
    )
    UPDATE agent_blueprint_revision r
    SET published_at = now()
    FROM target, activated
    WHERE r.id = target.id
    RETURNING r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash,
      r.message, r.author_id, r.status, r.created_at, r.published_at
  `;
  return rows[0] ? mapRevision(rows[0]) : null;
}

export async function simulateAgentBlueprintRevision(params: {
  tenantId: string; workspaceId: string; blueprintId: string; revisionId: string; limit?: number;
}): Promise<{ sourceEventCount: number; newlyBlockedCount: number; examples: Array<{ decisionId: string; connector: string; action: string }> } | null> {
  if (!sql) return null;
  const revisions = await sql<RevisionRow[]>`
    SELECT r.id, r.blueprint_id, r.parent_revision_id, r.definition, r.definition_hash, r.message, r.author_id, r.status, r.created_at, r.published_at
    FROM agent_blueprint_revision r JOIN agent_blueprint b ON b.id = r.blueprint_id AND b.tenant_id = r.tenant_id
    WHERE r.tenant_id = ${params.tenantId} AND b.workspace_id = ${params.workspaceId} AND r.blueprint_id = ${params.blueprintId} AND r.id = ${params.revisionId}
  `;
  const revision = revisions[0]; if (!revision) return null;
  const blueprint = await sql<{ agent_id: string }[]>`SELECT agent_id FROM agent_blueprint WHERE id = ${params.blueprintId} AND tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}`;
  const agentId = blueprint[0]?.agent_id; if (!agentId) return null;
  const events = await sql<{ decision_id: string; connector: string; action: string }[]>`
    SELECT decision_id, connector, action FROM runtime_evidence_event
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId} AND agent_id = ${agentId}
    ORDER BY created_at DESC LIMIT ${params.limit ?? 200}
  `;
  const definition = mapRevision(revision).definition;
  const blocked = events.filter((event) => !definition.connectors.includes(event.connector) || !definition.tools.some((tool) => tool === event.action || tool === `${event.connector}.${event.action}`));
  return { sourceEventCount: events.length, newlyBlockedCount: blocked.length, examples: blocked.slice(0, 20).map((event) => ({ decisionId: event.decision_id, connector: event.connector, action: event.action })) };
}
