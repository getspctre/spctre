"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "../admin-session";
import { getRequiredWorkspaceContext } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { createEvidenceIntegrationSetup } from "@/lib/domains/evidence/integration-service";
import { normalizeGenericEvidence } from "@/lib/domains/evidence/generic-mapping";
import { isRecord } from "@/lib/records";
import { logger } from "@spctre/platform/logging";

const providerTypes = [
  "generic_json",
  "generic_ndjson",
  "cloudevents",
  "otlp_logs",
  "bedrock_agentcore",
  "docker_ai_governance",
  "langsmith",
] as const;

export type EvidenceIntegrationSetupState =
  | { ok: true; integrationId: string; rawToken: string; tokenPrefix: string }
  | { ok?: never; error: string }
  | null;

export type EvidenceMappingPreviewState =
  | { ok: true; preview: Record<string, unknown> }
  | { ok?: never; error: string };

export async function previewEvidenceMappingAction(
  mappingText: string,
  sampleText: string,
): Promise<EvidenceMappingPreviewState> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error ?? "Admin permission is required." };
  try {
    const mapping: unknown = JSON.parse(mappingText);
    const sample: unknown = JSON.parse(sampleText);
    if (!isRecord(sample)) return { error: "Sample payload must be a JSON object." };
    return { ok: true, preview: normalizeGenericEvidence(sample, mapping) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not preview this mapping." };
  }
}

export async function createEvidenceIntegrationAction(
  _previous: EvidenceIntegrationSetupState,
  formData: FormData,
): Promise<EvidenceIntegrationSetupState> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error ?? "Admin permission is required." };
  const write = verifyWriteAccess(guard.session.tenantId);
  if (!write.allowed) return { error: write.error ?? "Write access denied." };
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 80);
  const providerType = String(formData.get("providerType") ?? "");
  const mappingText = String(formData.get("mapping") ?? "");
  if (!name) return { error: "An integration name is required." };
  if (!providerTypes.includes(providerType as (typeof providerTypes)[number]))
    return { error: "Choose a supported source type." };
  let fieldMapping: unknown;
  try {
    fieldMapping = JSON.parse(mappingText);
  } catch (error) {
    logger.warn("Evidence integration mapping JSON parse failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "Mapping must be valid JSON." };
  }
  try {
    const scope = await getRequiredWorkspaceContext();
    const result = await createEvidenceIntegrationSetup({
      tenantId: guard.session.tenantId,
      workspaceId: scope.workspaceId,
      principalId: guard.session.principalId,
      name,
      providerType: providerType as (typeof providerTypes)[number],
      fieldMapping,
    });
    revalidatePath("/admin/evidence-integrations");
    return {
      ok: true,
      integrationId: result.integration.id,
      rawToken: result.rawToken,
      tokenPrefix: result.tokenPrefix,
    };
  } catch (error) {
    logger.error("Evidence integration setup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: error instanceof Error ? error.message : "Could not create evidence integration.",
    };
  }
}
