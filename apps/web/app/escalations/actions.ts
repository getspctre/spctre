"use server";

import {
  claimEscalationDecision,
  resolveEscalationDecision,
} from "@/lib/domains/gateway/service";
import { revalidatePaths } from "@/lib/platform/cache";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { getActiveScope, getWorkspaceContext } from "@/lib/workspace";

export type ClaimEscalationState = { error: string } | { ok: true } | null;

async function verifyActiveWorkspaceWriteAccess(): Promise<{ error: string } | null> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  return writeCheck.allowed ? null : { error: writeCheck.error || "Write access denied." };
}

export async function claimEscalation(
  _prevState: ClaimEscalationState,
  formData: FormData
): Promise<ClaimEscalationState> {
  const denied = await verifyActiveWorkspaceWriteAccess();
  if (denied) return denied;

  const queueId = String(formData.get("queueId") ?? "").trim();
  const result = await claimEscalationDecision({ queueId }, await getActiveScope().catch(() => null));
  if ("error" in result) return result;
  revalidatePaths(["/escalations"]);
  return result;
}

export type ResolveEscalationState = { error: string } | { ok: true } | null;

export async function resolveEscalation(
  _prevState: ResolveEscalationState,
  formData: FormData
): Promise<ResolveEscalationState> {
  const denied = await verifyActiveWorkspaceWriteAccess();
  if (denied) return denied;

  const queueId = String(formData.get("queueId") ?? "").trim();
  const resolutionOutcome = String(formData.get("resolutionOutcome") ?? "").trim();
  const resolutionNote = String(formData.get("resolutionNote") ?? "").trim() || undefined;
  const agentGuidance = String(formData.get("agentGuidance") ?? "").trim() || undefined;

  const result = await resolveEscalationDecision({
    queueId,
    resolutionOutcome,
    resolutionNote,
    agentGuidance,
  }, await getActiveScope().catch(() => null));
  if ("error" in result) {
    return result;
  }

  revalidatePaths(["/escalations", "/review", "/operations"]);
  return result;
}
