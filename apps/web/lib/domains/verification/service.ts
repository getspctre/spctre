import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  ingestVerificationResult,
  listVerificationResults,
} from "@/lib/repositories/verification";

export async function ingestVerification(params: Parameters<typeof ingestVerificationResult>[0]) {
  return ingestVerificationResult(params);
}

export async function listVerificationRuns(params: {
  workspaceId: string;
  tenantId: string;
  revisionId?: string;
  artifactHash?: string;
  limit: number;
}) {
  return listVerificationResults(params.workspaceId, params.tenantId, {
    revisionId: params.revisionId,
    artifactHash: params.artifactHash,
    limit: params.limit,
  });
}

export async function recordVerificationOperation(params: Parameters<typeof appendOperationsLog>[0]) {
  return appendOperationsLog(params);
}
