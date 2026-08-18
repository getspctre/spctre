"use server";

import type { PolicyImportResult } from "@spctre/policy-schema";
import { createPolicyBranchDecision, importPolicyDecision } from "@/lib/domains/policy/service";
import { revalidatePaths } from "@/lib/platform/cache";
import { getWorkspaceContext } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";

export type ImportState =
  { result: PolicyImportResult; error?: never } | { error: string; result?: never } | null;

export type CreatePolicyBranchState =
  | { branchId: string; revisionId: string; error?: never }
  | { error: string; branchId?: never; revisionId?: never }
  | null;

export async function createPolicyBranch(
  _prev: CreatePolicyBranchState,
  formData: FormData,
): Promise<CreatePolicyBranchState> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const result = await createPolicyBranchDecision({
    branchName: ((formData.get("branchName") as string | null) ?? "").trim(),
    purpose: ((formData.get("purpose") as string | null) ?? "").trim(),
    scope: (formData.get("scope") as string | null) ?? "WORKSPACE",
    environment: ((formData.get("environment") as string | null) ?? "").trim(),
    connector: ((formData.get("connector") as string | null) ?? "").trim(),
    requestedWorkspaceId: ((formData.get("workspaceId") as string | null) ?? "").trim(),
    targetStacks: formData.getAll("targetStack").map(String).filter(Boolean),
  });
  if (!("error" in result)) revalidatePaths(["/"]);
  return result;
}

export async function importPolicy(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const pastedSource = (formData.get("source") as string | null) ?? "";
  const uploadedSource = formData.get("sourceFile");
  const sourceFile =
    uploadedSource instanceof File && uploadedSource.size > 0 ? uploadedSource : null;
  const source = pastedSource.trim() || (sourceFile ? await sourceFile.text() : "");
  const branchName = ((formData.get("branchName") as string | null) ?? "").trim();
  const scope = (formData.get("scope") as string | null) ?? "WORKSPACE";
  const environment = ((formData.get("environment") as string | null) ?? "").trim();
  const connector = ((formData.get("connector") as string | null) ?? "").trim();
  const requestedWorkspaceId = ((formData.get("workspaceId") as string | null) ?? "").trim();
  const requestedSourcePath = ((formData.get("sourcePath") as string | null) ?? "").trim();
  const sourcePath =
    requestedSourcePath ||
    (!pastedSource.trim() ? sourceFile?.name : undefined) ||
    `spctre-ui/${branchName || "policy"}.yaml`;
  const targetStacks = formData.getAll("targetStack").map(String).filter(Boolean);
  const requestedFormat = (formData.get("sourceFormat") as string | null) ?? "";
  const sourceFormat =
    requestedFormat === "AGT_YAML" || requestedFormat === "OPA_REGO" || requestedFormat === "CEDAR"
      ? requestedFormat
      : undefined;
  const acceptLossy = formData.get("acceptLossy") === "on";

  const result = await importPolicyDecision({
    source,
    branchName,
    scope,
    environment,
    connector,
    requestedWorkspaceId,
    sourcePath,
    sourceFormat,
    acceptLossy,
    targetStacks,
  });
  if ("error" in result) {
    return result;
  }

  revalidatePaths(["/"]);
  return result;
}
