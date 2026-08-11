import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  getGenericEvidenceIntegration,
  isGenericEvidenceDatabaseConfigured,
  persistGenericEvidence,
  type GenericIntegration,
} from "@/lib/repositories/evidence";
import { runWithTenantContext } from "@/lib/tenant-context";

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
    const result = await persistGenericEvidence({ integration, payload: params.payload });
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
