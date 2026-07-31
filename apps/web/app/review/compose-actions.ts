"use server";

import { revalidatePath } from "next/cache";
import { getReviewArtifacts } from "@/lib/repositories/policy";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import { getWorkspaceContext } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { swallow } from "@/lib/platform/swallow";

export type ComposeState =
  | { ok: true; refreshedAt: string; error?: never }
  | { error: string; ok?: never; refreshedAt?: never }
  | null;


export async function refreshReviewComposition(
  _prev: ComposeState,
  formData: FormData
): Promise<ComposeState> {
  const branchId = String(formData.get("branchId") ?? "").trim();
  const revisionId = String(formData.get("revisionId") ?? "").trim();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "").trim();

  if (!branchId || !revisionId) return { error: "Missing branch or revision." };

  const workspaceContext = await getWorkspaceContext({ workspaceSlug: workspaceSlug || undefined });

  if (isDatabaseConfigured()) {
    const reviewArtifacts = await getReviewArtifacts(
      branchId,
      revisionId,
      workspaceContext.workspaceId,
      workspaceContext.tenantId
    ).catch(swallow("getReviewArtifacts", null));

    if (!reviewArtifacts) {
      return { error: "Unable to compose review artifacts for this revision." };
    }
  }

  revalidatePath("/review");
  revalidatePath(buildWorkspacePath(workspaceContext.workspaceSlug, "/review"));

  return { ok: true, refreshedAt: new Date().toISOString() };
}
