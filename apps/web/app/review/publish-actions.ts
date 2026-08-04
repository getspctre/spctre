"use server";

import { addApprovalDecision, publishRevisionDecision } from "@/lib/domains/review/service";
import { rollbackBranchDecision } from "@/lib/domains/policy/service";
import { revalidatePaths } from "@/lib/platform/cache";
import { getActiveScope, getWorkspaceContext } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";

export type ApprovalState = { ok: true; error?: never } | { ok?: never; error: string } | null;

export type PublishState =
  { artifactHash: string; error?: never } | { error: string; artifactHash?: never } | null;

export type RollbackState =
  | { artifactHash: string; revisionId: string; error?: never }
  | { error: string; artifactHash?: never; revisionId?: never }
  | null;

export async function addApproval(
  _prev: ApprovalState,
  formData: FormData,
): Promise<ApprovalState> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const revisionId = formData.get("revisionId") as string;
  const role = formData.get("role") as string;
  const approvalStatus = formData.get("approvalStatus") as string;
  const note = (formData.get("note") as string | null) || null;

  const result = await addApprovalDecision(
    { revisionId, role, approvalStatus, note },
    await getActiveScope(),
  );
  if ("error" in result) {
    return result;
  }

  revalidatePaths(["/review", "/"]);
  return result;
}

export async function rollbackBranch(
  _prev: RollbackState,
  formData: FormData,
): Promise<RollbackState> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const branchId = formData.get("branchId") as string;
  const targetRevisionId = formData.get("targetRevisionId") as string;

  const result = await rollbackBranchDecision({ branchId, targetRevisionId });
  if ("error" in result) {
    return result;
  }

  revalidatePaths(["/review", "/", "/agents", "/compliance"]);
  return result;
}

export async function publishRevision(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const revisionId = formData.get("revisionId") as string;
  const branchId = formData.get("branchId") as string;

  const result = await publishRevisionDecision({ revisionId, branchId }, await getActiveScope());
  if ("error" in result) {
    return result;
  }

  revalidatePaths(["/review", "/", "/compliance", "/operations"]);
  return result;
}
