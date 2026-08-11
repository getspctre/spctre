import type { JSONValue } from "postgres";
import { logger } from "@spctre/platform/logging";
import { sql } from "@/lib/db";
import {
  normalizeGenericEvidence,
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
  const sourceEventID = evidenceSourceEventID(params.payload, params.integration.fieldMapping);
  const key = sourceIdempotencyKey(sourceEventID ?? undefined, params.payload);
  const sourceRows = await sql<{ id: string }[]>`
    INSERT INTO evidence_source_record (
      tenant_id, integration_id, mapping_revision_id, source_event_id, idempotency_key, content_hash, source_payload
    ) VALUES (
      ${params.integration.tenantId}::uuid, ${params.integration.id}::uuid,
      ${params.integration.mappingRevisionId}::uuid, ${sourceEventID}, ${key}, ${contentHash},
      ${sql.json(params.payload as JSONValue)}::jsonb
    )
    ON CONFLICT (tenant_id, integration_id, idempotency_key) DO NOTHING
    RETURNING id
  `;
  const sourceRecordId = sourceRows[0]?.id;
  if (!sourceRecordId) return { outcome: "duplicate" };

  let evidence: NormalizedGenericEvidence;
  try {
    evidence = normalizeGenericEvidence(params.payload, params.integration.fieldMapping);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "The active mapping rejected this record.";
    logger.warn("Generic evidence mapping rejected source record", {
      integrationId: params.integration.id,
      reason,
    });
    await sql`
      UPDATE evidence_source_record
      SET rejected_reason = ${reason}
      WHERE id = ${sourceRecordId}::uuid
    `;
    return { outcome: "rejected", sourceRecordId, reason };
  }

  // An external agent ID is useful provenance but is not an internal Spctre
  // agent correlation. Until the correlator resolves it, make that uncertainty
  // explicit so coverage dashboards do not overstate attribution.
  const unresolved = !evidence.agentExternalId;
  const correlationConfidence = unresolved ? 0 : 0.5;

  const rows = await sql<{ id: string }[]>`
    INSERT INTO canonical_evidence_event (
      tenant_id, workspace_id, source_record_id, mapping_revision_id, provider_type,
      source_event_id, occurred_at, received_at, principal_id, agent_external_id,
      action, target_resource, policy_reference, environment, enforcement_decision,
      correlation_confidence, unresolved, source_attributes
    ) VALUES (
      ${params.integration.tenantId}::uuid, ${params.integration.workspaceId}::uuid,
      ${sourceRecordId}::uuid, ${params.integration.mappingRevisionId}::uuid,
      ${params.integration.providerType}, ${evidence.sourceEventId ?? null},
      ${evidence.occurredAt}, now(), ${evidence.principalId ?? null},
      ${evidence.agentExternalId ?? null}, ${evidence.action}, ${evidence.targetResource ?? null},
      ${evidence.policyReference ?? null}, ${evidence.environment ?? null},
      ${evidence.enforcementDecision}, ${correlationConfidence}, ${unresolved},
      ${sql.json(evidence.sourceAttributes as JSONValue)}::jsonb
    )
    RETURNING id
  `;
  return { outcome: "accepted", sourceRecordId, canonicalEventId: rows[0]!.id, evidence };
}

function evidenceSourceEventID(payload: Record<string, unknown>, mapping: unknown): string | null {
  try {
    return normalizeGenericEvidence(payload, mapping).sourceEventId ?? null;
  } catch {
    // Invalid mappings still retain their receipt and rejection reason below.
    return null;
  }
}
