import type { JSONValue } from "postgres";
import { logger } from "@spctre/platform/logging";
import { sql } from "@/lib/db";
import {
  sourceContentHash,
  sourceIdempotencyKey,
  type NormalizedGenericEvidence,
} from "@/lib/domains/evidence/generic-mapping";

export type GenericIntegration = {
  id: string;
  tenantId: string;
  workspaceId: string;
  providerType:
    | "generic_json"
    | "generic_ndjson"
    | "cloudevents"
    | "otlp_logs"
    | "bedrock_agentcore"
    | "docker_ai_governance"
    | "langsmith";
  mappingRevisionId: string;
  mappingVersion: number;
  fieldMapping: unknown;
};

export function isGenericEvidenceDatabaseConfigured(): boolean {
  return Boolean(sql);
}

export type EvidenceIntegrationSummary = {
  id: string;
  name: string;
  providerType: GenericIntegration["providerType"];
  mappingVersion: number | null;
  active: boolean;
  createdAt: string;
};

export type GenericEvidenceProvenance = {
  canonicalEventId: string | null;
  sourceRecordId: string;
  integrationId: string;
  integrationName: string;
  sourceEventId: string | null;
  contentHash: string;
  mappingVersion: number | null;
  occurredAt: string | null;
  receivedAt: string;
  action: string | null;
  decision: string | null;
  canonicalAgentId: string | null;
  unresolved: boolean;
  rejectedReason: string | null;
};

export type GenericEvidenceCoverage = {
  providerType: string;
  total: number;
  resolved: number;
  unresolved: number;
  lastReceivedAt: string | null;
  stale: boolean;
};

export async function getGenericEvidenceCoverage(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<GenericEvidenceCoverage[]> {
  if (!sql) return [];
  return sql<GenericEvidenceCoverage[]>`
    SELECT integration.provider_type AS "providerType", COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE event.id IS NOT NULL AND NOT event.unresolved)::int AS resolved,
      COUNT(*) FILTER (WHERE event.id IS NULL OR event.unresolved)::int AS unresolved,
      MAX(source.received_at)::text AS "lastReceivedAt",
      MAX(source.received_at) < now() - interval '24 hours' AS stale
    FROM evidence_source_record source
    JOIN evidence_ingest_integration integration ON integration.id = source.integration_id
    LEFT JOIN canonical_evidence_event event ON event.source_record_id = source.id
    WHERE source.tenant_id = ${params.tenantId}::uuid
      AND integration.workspace_id = ${params.workspaceId}::uuid
    GROUP BY integration.provider_type
    ORDER BY MAX(source.received_at) DESC
  `;
}

export async function listGenericEvidenceProvenance(params: {
  tenantId: string;
  workspaceId: string;
  limit?: number;
}): Promise<GenericEvidenceProvenance[]> {
  if (!sql) return [];
  return sql<GenericEvidenceProvenance[]>`
    SELECT event.id::text AS "canonicalEventId", source.id::text AS "sourceRecordId",
           integration.id::text AS "integrationId", integration.name AS "integrationName",
           source.source_event_id AS "sourceEventId", source.content_hash AS "contentHash",
           mapping.version AS "mappingVersion", event.occurred_at::text AS "occurredAt",
           source.received_at::text AS "receivedAt", event.action, event.enforcement_decision AS decision,
           event.canonical_agent_id AS "canonicalAgentId",
           COALESCE(event.unresolved, true) AS unresolved, source.rejected_reason AS "rejectedReason"
    FROM evidence_source_record source
    JOIN evidence_ingest_integration integration ON integration.id = source.integration_id
    LEFT JOIN evidence_ingest_mapping_revision mapping ON mapping.id = source.mapping_revision_id
    LEFT JOIN canonical_evidence_event event ON event.source_record_id = source.id
    WHERE source.tenant_id = ${params.tenantId}::uuid
      AND integration.workspace_id = ${params.workspaceId}::uuid
    ORDER BY source.received_at DESC
    LIMIT ${Math.min(Math.max(params.limit ?? 50, 1), 200)}
  `;
}

export async function listEvidenceIntegrations(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<EvidenceIntegrationSummary[]> {
  if (!sql) return [];
  return sql<EvidenceIntegrationSummary[]>`
    SELECT integration.id, integration.name, integration.provider_type AS "providerType",
           mapping.version AS "mappingVersion", integration.active,
           integration.created_at::text AS "createdAt"
    FROM evidence_ingest_integration integration
    LEFT JOIN evidence_ingest_mapping_revision mapping
      ON mapping.integration_id = integration.id AND mapping.activated_at IS NOT NULL
    WHERE integration.tenant_id = ${params.tenantId}::uuid
      AND integration.workspace_id = ${params.workspaceId}::uuid
    ORDER BY integration.created_at DESC
  `;
}

export async function createEvidenceIntegration(params: {
  tenantId: string;
  workspaceId: string;
  serviceTokenId: string;
  name: string;
  providerType: GenericIntegration["providerType"];
  fieldMapping: unknown;
}): Promise<EvidenceIntegrationSummary> {
  if (!sql) throw new Error("Database not configured.");
  const rows = await sql.begin(async (tx) => {
    const integration = await tx<{ id: string; created_at: Date }[]>`
      INSERT INTO evidence_ingest_integration
        (tenant_id, workspace_id, service_token_id, provider_type, name)
      VALUES (
        ${params.tenantId}::uuid, ${params.workspaceId}::uuid,
        ${params.serviceTokenId}::uuid, ${params.providerType}, ${params.name}
      ) RETURNING id, created_at
    `;
    const mapping = await tx<{ version: number }[]>`
      INSERT INTO evidence_ingest_mapping_revision
        (tenant_id, integration_id, version, field_mapping, activated_at)
      VALUES (
        ${params.tenantId}::uuid, ${integration[0]!.id}::uuid, 1,
        ${tx.json(params.fieldMapping as JSONValue)}::jsonb, now()
      ) RETURNING version
    `;
    return {
      id: integration[0]!.id,
      version: mapping[0]!.version,
      createdAt: integration[0]!.created_at,
    };
  });
  return {
    id: rows.id,
    name: params.name,
    providerType: params.providerType,
    mappingVersion: rows.version,
    active: true,
    createdAt: rows.createdAt.toISOString(),
  };
}

export async function getGenericEvidenceIntegration(params: {
  tenantId: string;
  serviceTokenId: string;
  integrationId: string;
  providerType: GenericIntegration["providerType"];
}): Promise<GenericIntegration | null> {
  if (!sql) return null;
  const rows = await sql<
    {
      id: string;
      tenant_id: string;
      workspace_id: string;
      provider_type: GenericIntegration["providerType"];
      mapping_revision_id: string;
      version: number;
      field_mapping: unknown;
    }[]
  >`
    SELECT integration.id, integration.tenant_id, integration.workspace_id,
           integration.provider_type, mapping.id AS mapping_revision_id,
           mapping.version, mapping.field_mapping
    FROM evidence_ingest_integration integration
    JOIN evidence_ingest_mapping_revision mapping
      ON mapping.integration_id = integration.id
     AND mapping.activated_at IS NOT NULL
    WHERE integration.id = ${params.integrationId}::uuid
      AND integration.tenant_id = ${params.tenantId}::uuid
      AND integration.service_token_id = ${params.serviceTokenId}::uuid
      AND integration.provider_type = ${params.providerType}
      AND integration.active = true
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        providerType: row.provider_type,
        mappingRevisionId: row.mapping_revision_id,
        mappingVersion: row.version,
        fieldMapping: row.field_mapping,
      }
    : null;
}

export async function persistGenericEvidence(params: {
  integration: GenericIntegration;
  payload: Record<string, unknown>;
  evidence: NormalizedGenericEvidence | null;
  rejectedReason: string | null;
}): Promise<
  | {
      outcome: "accepted";
      sourceRecordId: string;
      canonicalEventId: string;
      evidence: NormalizedGenericEvidence;
    }
  | { outcome: "duplicate"; sourceRecordId?: string }
  | { outcome: "rejected"; sourceRecordId: string; reason: string }
> {
  if (!sql) throw new Error("Database not configured.");

  const contentHash = sourceContentHash(params.payload);
  const sourceEventID = params.evidence?.sourceEventId ?? null;
  const key = sourceIdempotencyKey(sourceEventID ?? undefined, params.payload);
  return sql.begin(async (tx) => {
    const sourceRows = await tx<{ id: string }[]>`
      INSERT INTO evidence_source_record (
        tenant_id, integration_id, mapping_revision_id, source_event_id, idempotency_key, content_hash, source_payload
      ) VALUES (
        ${params.integration.tenantId}::uuid, ${params.integration.id}::uuid,
        ${params.integration.mappingRevisionId}::uuid, ${sourceEventID}, ${key}, ${contentHash},
        ${tx.json(params.payload as JSONValue)}::jsonb
      )
      ON CONFLICT (tenant_id, integration_id, idempotency_key) DO NOTHING
      RETURNING id
    `;
    const sourceRecordId = sourceRows[0]?.id;
    if (!sourceRecordId) return { outcome: "duplicate" as const };

    const evidence = params.evidence;
    if (!evidence) {
      const reason = params.rejectedReason ?? "The active mapping rejected this record.";
      logger.warn("Generic evidence mapping rejected source record", {
        integrationId: params.integration.id,
        reason,
      });
      await tx`
        UPDATE evidence_source_record
        SET rejected_reason = ${reason}
        WHERE id = ${sourceRecordId}::uuid
      `;
      return { outcome: "rejected" as const, sourceRecordId, reason };
    }

    const canonicalAgentRows = evidence.agentExternalId
      ? await tx<{ canonical_agent_id: string }[]>`
          SELECT canonical_agent_id
          FROM agt_agent_surface_binding
          WHERE tenant_id = ${params.integration.tenantId}::uuid
            AND workspace_id = ${params.integration.workspaceId}::uuid
            AND surface_type = ${`evidence:${params.integration.providerType}`}
            AND surface_agent_id = ${evidence.agentExternalId}
          LIMIT 1
        `
      : [];
    const canonicalAgentId = canonicalAgentRows[0]?.canonical_agent_id ?? null;
    // An external agent ID is provenance, not a correlation. Only a binding in
    // the cross-surface identity registry resolves it to a canonical Spctre
    // agent. An unbound external ID is deliberately shown as partial confidence.
    const unresolved = !canonicalAgentId;
    const correlationConfidence = canonicalAgentId ? 1 : evidence.agentExternalId ? 0.5 : 0;

    const rows = await tx<{ id: string }[]>`
      INSERT INTO canonical_evidence_event (
        tenant_id, workspace_id, source_record_id, mapping_revision_id, provider_type,
        source_event_id, occurred_at, received_at, principal_id, agent_external_id, canonical_agent_id,
        action, target_resource, policy_reference, environment, enforcement_decision,
        correlation_confidence, unresolved, source_attributes
      ) VALUES (
        ${params.integration.tenantId}::uuid, ${params.integration.workspaceId}::uuid,
        ${sourceRecordId}::uuid, ${params.integration.mappingRevisionId}::uuid,
        ${params.integration.providerType}, ${evidence.sourceEventId ?? null},
        ${evidence.occurredAt}, now(), ${evidence.principalId ?? null},
        ${evidence.agentExternalId ?? null}, ${canonicalAgentId}, ${evidence.action}, ${evidence.targetResource ?? null},
        ${evidence.policyReference ?? null}, ${evidence.environment ?? null},
        ${evidence.enforcementDecision}, ${correlationConfidence}, ${unresolved},
        ${tx.json(evidence.sourceAttributes as JSONValue)}::jsonb
      )
      RETURNING id
    `;
    return {
      outcome: "accepted" as const,
      sourceRecordId,
      canonicalEventId: rows[0]!.id,
      evidence,
    };
  });
}
