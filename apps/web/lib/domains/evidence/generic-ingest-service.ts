import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { evidenceIngestUrl, workerInternalSecret } from "@/lib/platform/config";
import { fetchWithRetry } from "@/lib/platform/fetch-retry";
import { reportSwallowedError } from "@/lib/platform/swallow";
import {
  getGenericEvidenceIntegration,
  isGenericEvidenceDatabaseConfigured,
  persistGenericEvidence,
  type GenericIntegration,
} from "@/lib/repositories/evidence";
import { runWithTenantContext } from "@/lib/tenant-context";
import {
  normalizeGenericEvidence,
  sourceContentHash,
  sourceIdempotencyKey,
  type NormalizedGenericEvidence,
} from "@/lib/domains/evidence/generic-mapping";

export function isGenericEvidenceIngestAvailable(): boolean {
  return isGenericEvidenceDatabaseConfigured();
}

export async function ingestGenericEvidence(params: {
  tenantId: string;
  serviceTokenId: string;
  integrationId: string;
  providerType: GenericIntegration["providerType"];
  payload: Record<string, unknown>;
  actorId: string;
}) {
  return runWithTenantContext(params.tenantId, async () => {
    const integration = await getGenericEvidenceIntegration(params);
    if (!integration) return { outcome: "not_found" as const };
    const normalized = normalizeEvidence(params.payload, integration);
    const delegated = await delegateGenericEvidenceToWorker({ integration, normalized, ...params });
    if (delegated) return delegated;
    const result = await persistGenericEvidence({
      integration,
      payload: params.payload,
      evidence: normalized.evidence,
      rejectedReason: normalized.rejectedReason,
    });
    if (result.outcome === "accepted") {
      void appendOperationsLog({
        tenantId: params.tenantId,
        workspaceId: integration.workspaceId,
        eventType: "EVIDENCE_INGEST",
        sourceId: result.canonicalEventId,
        sourceTable: "canonical_evidence_event",
        actorId: params.actorId,
        payload: {
          integrationId: integration.id,
          mappingVersion: integration.mappingVersion,
          sourceRecordId: result.sourceRecordId,
          sourceEventId: result.evidence.sourceEventId,
          action: result.evidence.action,
          enforcementDecision: result.evidence.enforcementDecision,
        },
      });
    }
    return result;
  });
}

async function delegateGenericEvidenceToWorker(params: {
  integration: GenericIntegration;
  normalized: NormalizedEvidence;
  tenantId: string;
  serviceTokenId: string;
  integrationId: string;
  providerType: GenericIntegration["providerType"];
  payload: Record<string, unknown>;
  actorId: string;
}) {
  const baseUrl = evidenceIngestUrl();
  const secret = workerInternalSecret();
  if (!baseUrl || !secret) return null;

  const { evidence: canonical, rejectedReason } = params.normalized;
  const sourceEventId = canonical?.sourceEventId ?? null;
  const target = new URL(
    "/internal/generic-evidence",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const response = await fetchWithRetry(target, {
    method: "POST",
    headers: { "content-type": "application/json", "x-spctre-internal-secret": secret },
    body: JSON.stringify({
      tenantId: params.tenantId,
      workspaceId: params.integration.workspaceId,
      integrationId: params.integration.id,
      mappingRevisionId: params.integration.mappingRevisionId,
      serviceTokenId: params.serviceTokenId,
      providerType: params.providerType,
      actorId: params.actorId,
      sourceEventId,
      idempotencyKey: sourceIdempotencyKey(sourceEventId ?? undefined, params.payload),
      contentHash: sourceContentHash(params.payload),
      sourcePayload: params.payload,
      rejectedReason,
      canonical: canonical
        ? {
            sourceEventId: canonical.sourceEventId ?? null,
            occurredAt: canonical.occurredAt,
            principalId: canonical.principalId ?? null,
            agentExternalId: canonical.agentExternalId ?? null,
            action: canonical.action,
            targetResource: canonical.targetResource ?? null,
            policyReference: canonical.policyReference ?? null,
            environment: canonical.environment ?? null,
            enforcementDecision: canonical.enforcementDecision,
            correlationConfidence: canonical.agentExternalId ? 0.5 : 0,
            unresolved: !canonical.agentExternalId,
            sourceAttributes: canonical.sourceAttributes,
          }
        : null,
    }),
    cache: "no-store",
    timeoutMs: 15_000,
  });
  if (!response.ok) {
    throw new Error(`Worker generic evidence ingest failed with status ${response.status}.`);
  }
  const result = (await response.json()) as {
    outcome: "accepted" | "duplicate" | "rejected";
    sourceRecordId?: string;
    canonicalEventId?: string;
    reason?: string;
  };
  if (result.outcome === "accepted" && result.sourceRecordId && result.canonicalEventId) {
    return {
      outcome: "accepted" as const,
      sourceRecordId: result.sourceRecordId,
      canonicalEventId: result.canonicalEventId,
      evidence: canonical!,
    };
  }
  if (result.outcome === "duplicate") return { outcome: "duplicate" as const };
  if (result.outcome === "rejected" && result.sourceRecordId && result.reason) {
    return {
      outcome: "rejected" as const,
      sourceRecordId: result.sourceRecordId,
      reason: result.reason,
    };
  }
  throw new Error("Worker generic evidence ingest returned an invalid response.");
}

type NormalizedEvidence = {
  evidence: NormalizedGenericEvidence | null;
  rejectedReason: string | null;
};

function normalizeEvidence(
  payload: Record<string, unknown>,
  integration: GenericIntegration,
): NormalizedEvidence {
  try {
    return {
      evidence: normalizeGenericEvidence(payload, integration.fieldMapping),
      rejectedReason: null,
    };
  } catch (error) {
    reportSwallowedError("ingestGenericEvidence.mapping", error, {
      integrationId: integration.id,
    });
    return {
      evidence: null,
      rejectedReason:
        error instanceof Error ? error.message : "The active mapping rejected this record.",
    };
  }
}
