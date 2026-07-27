import { signActionReceipt, type SignedActionReceipt } from "@spctre/policy-schema";

function signingPrivateKey(): string | null {
  const value = process.env.SPCTRE_RECEIPT_SIGNING_PRIVATE_KEY?.trim();
  return value ? value.replace(/\\n/g, "\n") : null;
}

export function issueGatewayActionReceipt(params: {
  decisionId: string;
  branchId?: string;
  revisionId?: string;
  artifactHash: string;
  agentId?: string;
  connector?: string;
  action?: string;
  outcome: "PROCEED" | "ESCALATE" | "ABORT";
  actorId: string;
  reviewerId?: string;
}): SignedActionReceipt | null {
  const privateKey = signingPrivateKey();
  if (!privateKey) return null;
  return signActionReceipt({
    privateKey,
    keyId: process.env.SPCTRE_RECEIPT_SIGNING_KEY_ID?.trim() || "spctre-action-receipt-v1",
    payload: {
      decisionId: params.decisionId,
      branchId: params.branchId,
      revisionId: params.revisionId,
      artifactHash: params.artifactHash,
      runtimeTarget: [params.connector, params.action].filter(Boolean).join(".") || "gateway",
      action: { agentId: params.agentId, connector: params.connector, name: params.action },
      outcome: params.outcome,
      actorId: params.actorId,
      reviewerId: params.reviewerId,
      issuedAt: new Date().toISOString(),
    },
  });
}
