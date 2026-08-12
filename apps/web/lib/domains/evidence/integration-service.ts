import { issueServiceAccountKeyInTransaction } from "@/lib/service-tokens";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  createEvidenceIntegrationInTransaction,
  getGenericEvidenceCoverage,
  listEvidenceIntegrations,
  listGenericEvidenceProvenance,
  type GenericIntegration,
} from "@/lib/repositories/evidence";
import { sql } from "@/lib/db";
import { runWithTenantContext } from "@/lib/tenant-context";
import { validateEvidenceMapping } from "./generic-mapping";

export async function getEvidenceIntegrations(params: { tenantId: string; workspaceId: string }) {
  return runWithTenantContext(params.tenantId, () => listEvidenceIntegrations(params));
}

export async function getGenericEvidenceProvenance(params: {
  tenantId: string;
  workspaceId: string;
}) {
  return runWithTenantContext(params.tenantId, () => listGenericEvidenceProvenance(params));
}

export async function getGenericEvidenceCoverageModel(params: {
  tenantId: string;
  workspaceId: string;
}) {
  return runWithTenantContext(params.tenantId, () => getGenericEvidenceCoverage(params));
}

export async function createEvidenceIntegrationSetup(params: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  name: string;
  providerType: GenericIntegration["providerType"];
  fieldMapping: unknown;
}) {
  const mapping = validateEvidenceMapping(params.fieldMapping);
  return runWithTenantContext(params.tenantId, async () => {
    if (!sql) throw new Error("Database not configured.");
    const { key, integration } = await sql.begin(async (tx) => {
      const key = await issueServiceAccountKeyInTransaction(tx, {
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        principalId: params.principalId,
        createdBy: params.principalId,
        label: `Evidence ingest: ${params.name}`,
        scopes: ["evidence:write"],
      });
      const integration = await createEvidenceIntegrationInTransaction(tx, {
        ...params,
        serviceTokenId: key.tokenId,
        fieldMapping: mapping,
      });
      return { key, integration };
    });
    await appendOperationsLog({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "TOKEN_ISSUED",
      sourceId: integration.id,
      sourceTable: "evidence_ingest_integration",
      actorId: params.principalId,
      payload: {
        providerType: params.providerType,
        mappingVersion: 1,
        serviceTokenId: key.tokenId,
      },
    });
    return { integration, rawToken: key.rawToken, tokenPrefix: key.tokenPrefix };
  });
}
