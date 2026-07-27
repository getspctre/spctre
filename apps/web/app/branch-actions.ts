"use server";

import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import { getRequiredWorkspaceContext } from "@/lib/workspace";
import { deleteUnpublishedBranchDecision } from "@/lib/domains/policy/service";
import { findActorById } from "@/lib/actors";
import { verifyWriteAccess } from "@/lib/demo-guard";

export type DeleteBranchState = { error: string } | { success: true } | null;

export async function deleteBranchAdmin(
  _prevState: DeleteBranchState,
  formData: FormData
): Promise<DeleteBranchState> {
  const session = await getAuthSession().catch(() => null);
  if (!session) return { error: "Authentication required." };

  const { workspaceId, tenantId } = await getRequiredWorkspaceContext();
  const writeCheck = verifyWriteAccess(tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const actor = await findActorById(session.principalId, {
    tenantId,
    workspaceId
  }).catch(() => null);
  if (!actor?.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission required." };
  }

  const branchId = String(formData.get("branchId") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();

  if (!branchId) return { error: "Branch ID is required." };
  if (confirm !== "DELETE") return { error: 'Type DELETE (all caps) to confirm.' };

  const deleteResult = await deleteUnpublishedBranchDecision({
    tenantId,
    branchId,
  });
  if ("error" in deleteResult) return deleteResult;

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");

  return { success: true };
}
