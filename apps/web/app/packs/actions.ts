"use server";

import { revalidatePath } from "next/cache";
import { importPolicyPackDecision } from "@/lib/domains/packs/service";
import type { ImportState } from "@/app/policy/actions";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { getWorkspaceContext } from "@/lib/workspace";

export type { ImportState } from "@/app/policy/actions";

export async function importPolicyPack(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const packId = (formData.get("packId") as string | null) ?? "";
  const mode = ((formData.get("mode") as string | null) ?? "install").trim().toLowerCase();
  const preserveCustomizations =
    (formData.get("preserveCustomizations") as string | null) === "true";
  const requestedWorkspaceId = ((formData.get("workspaceId") as string | null) ?? "").trim();
  const publish = formData.get("publish") === "true";
  const result = await importPolicyPackDecision({
    packId,
    mode,
    preserveCustomizations,
    requestedWorkspaceId,
    immediatelyPublish: publish,
  });
  if ("error" in result) {
    return result;
  }

  revalidatePath("/");
  revalidatePath("/packs");
  if (result.workspaceSlug) {
    revalidatePath(`/${result.workspaceSlug}/packs`);
  }

  return { result: result.result };
}
