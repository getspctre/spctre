import { logger } from "@spctre/platform/logging";
import type { JSONValue } from "postgres";
import { sql, rawSql } from "@/lib/db";
import {
  buildCrossSurfaceIdentityHistory,
  type AgentSurfaceBinding,
  type AgentSurfaceType,
  type CrossSurfaceIdentityEvent,
  type CrossSurfaceIdentityHistory,
  type IdentityEventSource,
  type IdentityLifecycleEvent,
  type IdentityLifecycleEventType,
} from "@spctre/policy-schema";

export async function recordIdentityLifecycleEvent(params: {
  tenantId: string;
  workspaceId?: string;
  principalId: string;
  eventType: IdentityLifecycleEventType;
  actorId: string;
  source: IdentityEventSource;
  detail?: Record<string, unknown>;
  agentDid?: string;
  signatureAlgorithm?: string;
  signatureKeyId?: string;
  payloadHash?: string;
  signature?: string;
  signatureVerificationOutcome?: "PASS" | "FAIL" | "WARN";
  signatureFailureReason?: string;
  signatureVerifiedAt?: string;
}): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO agt_identity_lifecycle_event (
        tenant_id, workspace_id, principal_id, event_type, actor_id, source, detail,
        agent_did, signature_algorithm, signature_key_id, payload_hash, signature,
        signature_verification_outcome, signature_failure_reason, signature_verified_at
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId ?? null}, ${params.principalId},
        ${params.eventType}, ${params.actorId}, ${params.source},
        ${sql.json((params.detail ?? {}) as JSONValue)}::jsonb,
        ${params.agentDid ?? null}, ${params.signatureAlgorithm ?? null}, ${params.signatureKeyId ?? null},
        ${params.payloadHash ?? null}, ${params.signature ?? null},
        ${params.signatureVerificationOutcome ?? null}, ${params.signatureFailureReason ?? null},
        ${params.signatureVerifiedAt ?? null}
      )
    `;
  } catch (err) {
    logger.error("[identity_lifecycle] record failed:", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function listIdentityLifecycleEvents(
  tenantId: string,
  options: { principalId?: string; eventType?: IdentityLifecycleEventType; limit?: number } = {}
): Promise<IdentityLifecycleEvent[]> {
  if (!sql) return [];
  const limit = options.limit ?? 100;
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string | null;
      principal_id: string;
      event_type: string;
      actor_id: string;
      source: string;
      detail: unknown;
      agent_did: string | null;
      signature_algorithm: string | null;
      signature_key_id: string | null;
      payload_hash: string | null;
      signature: string | null;
      signature_verification_outcome: string | null;
      signature_failure_reason: string | null;
      signature_verified_at: Date | null;
      created_at: Date;
    }[]>`
      SELECT id, tenant_id, workspace_id, principal_id, event_type,
             actor_id, source, detail,
             agent_did, signature_algorithm, signature_key_id, payload_hash, signature,
             signature_verification_outcome, signature_failure_reason, signature_verified_at,
             created_at
      FROM agt_identity_lifecycle_event
      WHERE tenant_id = ${tenantId}
        ${options.principalId ? rawSql`AND principal_id = ${options.principalId}` : rawSql``}
        ${options.eventType ? rawSql`AND event_type = ${options.eventType}` : rawSql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id ?? undefined,
      principalId: row.principal_id,
      eventType: row.event_type as IdentityLifecycleEventType,
      actorId: row.actor_id,
      source: row.source as IdentityEventSource,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      agentDid: row.agent_did ?? undefined,
      signatureAlgorithm: row.signature_algorithm ?? undefined,
      signatureKeyId: row.signature_key_id ?? undefined,
      payloadHash: row.payload_hash ?? undefined,
      signature: row.signature ?? undefined,
      signatureVerificationOutcome: row.signature_verification_outcome as IdentityLifecycleEvent["signatureVerificationOutcome"] | undefined,
      signatureFailureReason: row.signature_failure_reason ?? undefined,
      signatureVerifiedAt: row.signature_verified_at?.toISOString() ?? undefined,
      createdAt: row.created_at.toISOString(),
    }));
  } catch {
    return [];
  }
}

// ── Cross-surface agent identity bindings ─────────────────────────────────────

export async function createAgentSurfaceBinding(params: {
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  surfaceType: AgentSurfaceType;
  surfaceAgentId: string;
  createdBy: string;
}): Promise<AgentSurfaceBinding | null> {
  if (!sql) return null;
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      canonical_agent_id: string;
      surface_type: string;
      surface_agent_id: string;
      created_by: string;
      created_at: Date;
    }[]>`
      INSERT INTO agt_agent_surface_binding (
        tenant_id, workspace_id, canonical_agent_id,
        surface_type, surface_agent_id, created_by
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.canonicalAgentId},
        ${params.surfaceType}, ${params.surfaceAgentId}, ${params.createdBy}
      )
      ON CONFLICT (tenant_id, workspace_id, surface_type, surface_agent_id) DO NOTHING
      RETURNING *
    `;
    const row = rows[0];
    if (!row) return null;
    return mapSurfaceBindingRow(row);
  } catch (err) {
    logger.error("[agent_surface_binding] create failed:", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function deleteAgentSurfaceBinding(params: {
  id: string;
  tenantId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`
      DELETE FROM agt_agent_surface_binding
      WHERE id = ${params.id}
        AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
    `;
    return true;
  } catch {
    return false;
  }
}

export async function listAgentSurfaceBindings(params: {
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
}): Promise<AgentSurfaceBinding[]> {
  if (!sql) return [];
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      canonical_agent_id: string;
      surface_type: string;
      surface_agent_id: string;
      created_by: string;
      created_at: Date;
    }[]>`
      SELECT id, tenant_id, workspace_id, canonical_agent_id,
             surface_type, surface_agent_id, created_by, created_at
      FROM agt_agent_surface_binding
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND canonical_agent_id = ${params.canonicalAgentId}
      ORDER BY created_at ASC
    `;
    return rows.map(mapSurfaceBindingRow);
  } catch {
    return [];
  }
}

export async function listAllSurfaceBindingsForWorkspace(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<AgentSurfaceBinding[]> {
  if (!sql) return [];
  try {
    const rows = await sql<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      canonical_agent_id: string;
      surface_type: string;
      surface_agent_id: string;
      created_by: string;
      created_at: Date;
    }[]>`
      SELECT id, tenant_id, workspace_id, canonical_agent_id,
             surface_type, surface_agent_id, created_by, created_at
      FROM agt_agent_surface_binding
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
      ORDER BY canonical_agent_id, created_at ASC
    `;
    return rows.map(mapSurfaceBindingRow);
  } catch {
    return [];
  }
}

/** Resolve a runtime-local identity to its workspace canonical agent identity. */
export async function resolveCanonicalAgentId(params: {
  tenantId: string; workspaceId: string; agentId: string;
}): Promise<string> {
  if (!sql) return params.agentId;
  const rows = await sql<{ canonical_agent_id: string }[]>`
    SELECT canonical_agent_id FROM agt_agent_surface_binding
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
      AND surface_agent_id = ${params.agentId}
    LIMIT 1
  `;
  return rows[0]?.canonical_agent_id ?? params.agentId;
}

// Shared context for each cross-surface source query.
interface CrossSurfaceQueryContext {
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  boundAgentIds: string[];
  limit: number;
  /** Resolve a runtime-local id to its bound surface type; undefined for canonical-native events. */
  surfaceType: (agentId: string) => AgentSurfaceType | undefined;
}

async function crossSurfaceDecisionEvents(ctx: CrossSurfaceQueryContext): Promise<CrossSurfaceIdentityEvent[]> {
  if (!sql) return [];
  try {
    const rows = await sql<{
      decision_id: string; connector: string; action: string; status: string;
      reason: string | null; agent_id: string; created_at: Date;
    }[]>`
      SELECT decision_id, connector, action, status, reason, agent_id, created_at
      FROM runtime_evidence_event
      WHERE tenant_id = ${ctx.tenantId} AND workspace_id = ${ctx.workspaceId}
        AND agent_id = ANY(${ctx.boundAgentIds})
      ORDER BY created_at DESC LIMIT ${ctx.limit}
    `;
    return rows.map((row) => ({
      kind: "DECISION",
      at: row.created_at.toISOString(),
      surfaceAgentId: row.agent_id,
      surfaceType: ctx.surfaceType(row.agent_id),
      summary: `${row.status} on ${row.connector}.${row.action}`,
      status: row.status,
      connector: row.connector,
      action: row.action,
      ref: row.decision_id,
      detail: row.reason ? { reason: row.reason } : undefined,
    }));
  } catch (err) {
    logger.error("[cross_surface_history] decisions failed:", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function crossSurfaceTrustEvents(ctx: CrossSurfaceQueryContext): Promise<CrossSurfaceIdentityEvent[]> {
  if (!sql) return [];
  try {
    const rows = await sql<{
      id: string; agent_id: string; trust_score: string; delta: string | null;
      source: string; reason: string | null; created_at: Date;
    }[]>`
      SELECT id, agent_id, trust_score, delta, source, reason, created_at
      FROM agt_trust_score_event
      WHERE tenant_id = ${ctx.tenantId} AND workspace_id = ${ctx.workspaceId}
        AND agent_id = ANY(${ctx.boundAgentIds})
      ORDER BY created_at DESC LIMIT ${ctx.limit}
    `;
    return rows.map((row) => {
      const trustScore = Number.parseFloat(row.trust_score);
      const delta = row.delta !== null ? Number.parseFloat(row.delta) : undefined;
      return {
        kind: "TRUST",
        at: row.created_at.toISOString(),
        surfaceAgentId: row.agent_id,
        surfaceType: ctx.surfaceType(row.agent_id),
        summary: `Trust ${trustScore.toFixed(2)}${delta !== undefined ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})` : ""}`,
        status: row.source,
        ref: row.id,
        detail: { trustScore, ...(delta !== undefined ? { delta } : {}), ...(row.reason ? { reason: row.reason } : {}) },
      };
    });
  } catch (err) {
    logger.error("[cross_surface_history] trust failed:", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function crossSurfaceIdentityEvents(ctx: CrossSurfaceQueryContext): Promise<CrossSurfaceIdentityEvent[]> {
  if (!sql) return [];
  try {
    // Identity lifecycle events are recorded against the canonical principal.
    const rows = await sql<{
      id: string; principal_id: string; event_type: string; detail: unknown; created_at: Date;
    }[]>`
      SELECT id, principal_id, event_type, detail, created_at
      FROM agt_identity_lifecycle_event
      WHERE tenant_id = ${ctx.tenantId} AND principal_id = ${ctx.canonicalAgentId}
      ORDER BY created_at DESC LIMIT ${ctx.limit}
    `;
    return rows.map((row) => ({
      kind: "IDENTITY",
      at: row.created_at.toISOString(),
      surfaceAgentId: row.principal_id,
      surfaceType: undefined,
      summary: row.event_type.replace(/_/g, " ").toLowerCase(),
      status: row.event_type,
      ref: row.id,
      detail: row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : undefined,
    }));
  } catch (err) {
    logger.error("[cross_surface_history] identity failed:", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function crossSurfaceReviewEvents(ctx: CrossSurfaceQueryContext): Promise<CrossSurfaceIdentityEvent[]> {
  if (!sql) return [];
  try {
    const rows = await sql<{
      decision_id: string; agent_id: string | null; resolution_outcome: string | null;
      resolution_note: string | null; connector: string | null; action: string | null; resolved_at: Date;
    }[]>`
      SELECT geq.decision_id, gd.agent_id,
             geq.resolution_outcome, geq.resolution_note, gd.connector, gd.action, geq.resolved_at
      FROM gateway_escalation_queue geq
      JOIN gateway_decision gd ON gd.id = geq.gateway_decision_id AND gd.tenant_id = geq.tenant_id
      WHERE geq.tenant_id = ${ctx.tenantId} AND geq.workspace_id = ${ctx.workspaceId}
        AND geq.status = 'RESOLVED' AND geq.resolved_at IS NOT NULL
        AND gd.agent_id = ANY(${ctx.boundAgentIds})
      ORDER BY geq.resolved_at DESC LIMIT ${ctx.limit}
    `;
    return rows.map((row) => {
      const agentId = row.agent_id ?? ctx.canonicalAgentId;
      return {
        kind: "REVIEW",
        at: row.resolved_at.toISOString(),
        surfaceAgentId: agentId,
        surfaceType: ctx.surfaceType(agentId),
        summary: `Reviewer ${row.resolution_outcome ?? "resolved"}${row.connector ? ` on ${row.connector}${row.action ? `.${row.action}` : ""}` : ""}`,
        status: row.resolution_outcome ?? undefined,
        connector: row.connector ?? undefined,
        action: row.action ?? undefined,
        ref: row.decision_id,
        detail: row.resolution_note ? { note: row.resolution_note } : undefined,
      };
    });
  } catch (err) {
    logger.error("[cross_surface_history] reviews failed:", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Build a canonical agent's unified cross-surface history: policy decisions,
 * trust-score changes, identity lifecycle events, and reviewer resolutions
 * correlated across every runtime surface bound to the agent. The `agentId`
 * argument may be either the canonical identity or any bound surface identity;
 * it is resolved to canonical first so a link from an evidence record or an
 * escalation (which carries a surface-local id) lands on the same timeline.
 */
export async function listCrossSurfaceIdentityHistory(params: {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  limit?: number;
}): Promise<CrossSurfaceIdentityHistory> {
  const limit = Math.max(1, Math.min(500, params.limit ?? 100));
  const canonicalAgentId = await resolveCanonicalAgentId({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    agentId: params.agentId,
  });

  if (!sql) {
    return buildCrossSurfaceIdentityHistory({ canonicalAgentId, surfaces: [], events: [] });
  }

  const surfaces = await listAgentSurfaceBindings({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    canonicalAgentId,
  });
  const surfaceTypeByAgentId = new Map(surfaces.map((binding) => [binding.surfaceAgentId, binding.surfaceType]));

  // Bound surface identities, resolved once and reused as an explicit id list so
  // each source query can match by canonical or any surface identity uniformly.
  const ctx: CrossSurfaceQueryContext = {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    canonicalAgentId,
    boundAgentIds: Array.from(new Set([canonicalAgentId, ...surfaces.map((binding) => binding.surfaceAgentId)])),
    limit,
    surfaceType: (agentId) => (agentId === canonicalAgentId ? undefined : surfaceTypeByAgentId.get(agentId)),
  };

  const sources = await Promise.all([
    crossSurfaceDecisionEvents(ctx),
    crossSurfaceTrustEvents(ctx),
    crossSurfaceIdentityEvents(ctx),
    crossSurfaceReviewEvents(ctx),
  ]);

  return buildCrossSurfaceIdentityHistory({
    canonicalAgentId,
    surfaces,
    events: sources.flat(),
    limit,
    generatedAt: new Date().toISOString(),
  });
}

function mapSurfaceBindingRow(row: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  canonical_agent_id: string;
  surface_type: string;
  surface_agent_id: string;
  created_by: string;
  created_at: Date;
}): AgentSurfaceBinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    canonicalAgentId: row.canonical_agent_id,
    surfaceType: row.surface_type as AgentSurfaceType,
    surfaceAgentId: row.surface_agent_id,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listApiKeysForWorkspace(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<{
  id: string;
  label: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}[]> {
  if (!sql) return [];
  return sql<{
    id: string;
    label: string;
    token_prefix: string;
    scopes: string[];
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string;
  }[]>`
    SELECT id, label, token_prefix, scopes, expires_at, last_used_at, created_at
    FROM service_token
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND key_type = 'API_KEY'
      AND revoked_at IS NULL
    ORDER BY created_at DESC
  `;
}
