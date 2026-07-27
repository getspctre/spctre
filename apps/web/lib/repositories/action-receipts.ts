import { sql } from "@/lib/db";
import type { SignedActionReceipt } from "@spctre/policy-schema";

export async function persistActionReceipt(params: {
  tenantId: string;
  workspaceId: string;
  gatewayDecisionId: string;
  stage?: "DECISION" | "RESOLUTION";
  receipt: SignedActionReceipt;
}): Promise<SignedActionReceipt | null> {
  if (!sql) return null;
  const rows = await sql<{ receipt: unknown }[]>`
    INSERT INTO action_receipt (
      tenant_id, workspace_id, gateway_decision_id, receipt_id, decision_id,
      revision_id, branch_id, artifact_hash, outcome, actor_id, reviewer_id,
      runtime_target, issued_at, key_id, public_key, payload_hash, signature, receipt_stage, receipt
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.gatewayDecisionId}::uuid,
      ${params.receipt.payload.receiptId}, ${params.receipt.payload.decisionId},
      ${params.receipt.payload.revisionId ?? null}, ${params.receipt.payload.branchId ?? null},
      ${params.receipt.payload.artifactHash}, ${params.receipt.payload.outcome},
      ${params.receipt.payload.actorId}, ${params.receipt.payload.reviewerId ?? null},
      ${params.receipt.payload.runtimeTarget}, ${params.receipt.payload.issuedAt}::timestamptz,
      ${params.receipt.signature.keyId}, ${params.receipt.signature.publicKey},
      ${params.receipt.signature.payloadHash}, ${params.receipt.signature.value},
      ${params.stage ?? "DECISION"},
      ${JSON.stringify(params.receipt)}::jsonb
    )
    ON CONFLICT (tenant_id, gateway_decision_id, receipt_stage) DO NOTHING
    RETURNING receipt
  `;
  if (rows[0]?.receipt) return rows[0].receipt as SignedActionReceipt;
  const existing = await sql<{ receipt: unknown }[]>`
    SELECT receipt FROM action_receipt
    WHERE tenant_id = ${params.tenantId}
      AND gateway_decision_id = ${params.gatewayDecisionId}::uuid
      AND receipt_stage = ${params.stage ?? "DECISION"}
    LIMIT 1
  `;
  return (existing[0]?.receipt as SignedActionReceipt | undefined) ?? null;
}

export async function listActionReceipts(params: {
  tenantId: string;
  workspaceId: string | null;
  revisionId: string;
}): Promise<SignedActionReceipt[]> {
  if (!sql) return [];
  const rows = await sql<{ receipt: unknown }[]>`
    SELECT receipt FROM action_receipt
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id IS NOT DISTINCT FROM ${params.workspaceId}
      AND revision_id = ${params.revisionId}
    ORDER BY issued_at ASC
  `;
  return rows.map((row) => row.receipt as SignedActionReceipt);
}

export async function getActionReceipt(params: {
  tenantId: string;
  workspaceId: string;
  receiptId: string;
}): Promise<SignedActionReceipt | null> {
  if (!sql) return null;
  const rows = await sql<{ receipt: unknown }[]>`
    SELECT receipt FROM action_receipt
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND receipt_id = ${params.receiptId}
    LIMIT 1
  `;
  return (rows[0]?.receipt as SignedActionReceipt | undefined) ?? null;
}
