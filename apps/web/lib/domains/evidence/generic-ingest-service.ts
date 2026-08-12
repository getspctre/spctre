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
  const results = await ingestGenericEvidenceBatch({ ...params, payloads: [params.payload] });
  return results[0]!;
}

export async function ingestGenericEvidenceBatch(params: {
  tenantId: string;
  serviceTokenId: string;
  integrationId: string;
  providerType: GenericIntegration["providerType"];
  payloads: Record<string, unknown>[];
  actorId: string;
}) {
  return runWithTenantContext(params.tenantId, async () => {
    const integration = await getGenericEvidenceIntegration(params);
    if (!integration) return params.payloads.map(() => ({ outcome: "not_found" as const }));
    const normalized = params.payloads.map((payload) => normalizeEvidence(payload, integration));
    const delegated = await delegateGenericEvidenceBatchToWorker({
      integration,
      normalized,
      ...params,
    });
    if (delegated) return delegated;
    const results = [];
    for (let index = 0; index < params.payloads.length; index++) {
      let result;
      try {
        result = await persistGenericEvidence({
          integration,
          payload: params.payloads[index]!,
          evidence: normalized[index]!.evidence,
          rejectedReason: normalized[index]!.rejectedReason,
        });
        if (result.outcome === "accepted")
          await appendFallbackOperationsLog(params, integration, result);
      } catch (error) {
        reportSwallowedError("ingestGenericEvidenceBatch.persist", error, {
          integrationId: integration.id,
        });
        results.push({ outcome: "rejected" as const, reason: "Unable to persist this record." });
        continue;
      }
      results.push(result);
    }
    return results;
  });
}

async function delegateGenericEvidenceBatchToWorker(params: {
  integration: GenericIntegration;
  normalized: NormalizedEvidence[];
  tenantId: string;
  serviceTokenId: string;
  integrationId: string;
  providerType: GenericIntegration["providerType"];
  payloads: Record<string, unknown>[];
  actorId: string;
}) {
  const baseUrl = evidenceIngestUrl();
  const secret = workerInternalSecret();
  if (!baseUrl || !secret) return null;

  const target = new URL(
    "/internal/generic-evidence",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const response = await fetchWithRetry(target, {
    method: "POST",
    headers: { "content-type": "application/json", "x-spctre-internal-secret": secret },
    body: JSON.stringify({
      commands: params.payloads.map((payload, index) =>
        workerCommand(params, payload, params.normalized[index]!),
      ),
    }),
    cache: "no-store",
    timeoutMs: 15_000,
  });
  if (!response.ok) {
    throw new Error(`Worker generic evidence ingest failed with status ${response.status}.`);
  }
  const result = (await response.json()) as { results?: WorkerResult[] };
  if (!result.results || result.results.length !== params.payloads.length)
    throw new Error("Worker generic evidence ingest returned an invalid response.");
  return result.results.map((item, index) => workerResult(item, params.normalized[index]!));
}

type WorkerResult = {
  outcome: "accepted" | "duplicate" | "rejected";
  sourceRecordId?: string;
  canonicalEventId?: string;
  reason?: string;
};

function workerCommand(
  params: {
    integration: GenericIntegration;
    tenantId: string;
    serviceTokenId: string;
    providerType: GenericIntegration["providerType"];
    actorId: string;
  },
  payload: Record<string, unknown>,
  normalized: NormalizedEvidence,
) {
  const canonical = normalized.evidence;
  const sourceEventId = canonical?.sourceEventId ?? null;
  return {
    tenantId: params.tenantId,
    workspaceId: params.integration.workspaceId,
    integrationId: params.integration.id,
    mappingRevisionId: params.integration.mappingRevisionId,
    serviceTokenId: params.serviceTokenId,
    providerType: params.providerType,
    actorId: params.actorId,
    sourceEventId,
    idempotencyKey: sourceIdempotencyKey(sourceEventId ?? undefined, payload),
    contentHash: sourceContentHash(payload),
    sourcePayload: payload,
    rejectedReason: normalized.rejectedReason,
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
  };
}

function workerResult(result: WorkerResult, normalized: NormalizedEvidence) {
  if (
    result.outcome === "accepted" &&
    result.sourceRecordId &&
    result.canonicalEventId &&
    normalized.evidence
  )
    return {
      outcome: "accepted" as const,
      sourceRecordId: result.sourceRecordId,
      canonicalEventId: result.canonicalEventId,
      evidence: normalized.evidence,
    };
  if (result.outcome === "duplicate") return { outcome: "duplicate" as const };
  if (result.outcome === "rejected" && result.reason)
    return {
      outcome: "rejected" as const,
      ...(result.sourceRecordId ? { sourceRecordId: result.sourceRecordId } : {}),
      reason: result.reason,
    };
  throw new Error("Worker generic evidence ingest returned an invalid response.");
}

async function appendFallbackOperationsLog(
  params: { tenantId: string; actorId: string },
  integration: GenericIntegration,
  result: { sourceRecordId: string; canonicalEventId: string; evidence: NormalizedGenericEvidence },
) {
  // The worker writes this event in its persistence transaction. This fallback
  // must await its post-commit append so audit failures cannot be silent.
  await appendOperationsLog({
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
    reportSwallowedError("ingestGenericEvidence.mapping", error, { integrationId: integration.id });
    return {
      evidence: null,
      rejectedReason:
        error instanceof Error ? error.message : "The active mapping rejected this record.",
    };
  }
}
