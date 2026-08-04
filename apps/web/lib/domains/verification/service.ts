import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { ingestVerificationResult, listVerificationResults } from "@/lib/repositories/verification";
import { runWithTenantContext } from "@/lib/tenant-context";

export async function ingestVerification(params: Parameters<typeof ingestVerificationResult>[0]) {
  return runWithTenantContext(params.tenantId, () => ingestVerificationResult(params));
}

export async function listVerificationRuns(params: {
  workspaceId: string;
  tenantId: string;
  revisionId?: string;
  artifactHash?: string;
  limit: number;
}) {
  return runWithTenantContext(params.tenantId, () =>
    listVerificationResults(params.workspaceId, params.tenantId, {
      revisionId: params.revisionId,
      artifactHash: params.artifactHash,
      limit: params.limit,
    }),
  );
}

export async function recordVerificationOperation(
  params: Parameters<typeof appendOperationsLog>[0],
) {
  return appendOperationsLog(params);
}
