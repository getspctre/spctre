"use server";

import { runSimulationDecision } from "@/lib/domains/evidence/service";
import {
  applySimulationChangeDecision,
  generateSimulationChangeRecommendation as generateSimulationChangeRecommendationDecision,
  type SimulationChangeRecommendation,
} from "@/lib/domains/simulation-change/service";
import { revalidatePaths } from "@/lib/platform/cache";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { getActiveScope, getWorkspaceContext } from "@/lib/workspace";

export type SimulationState =
  | { newlyDenied: number; newlyAllowed: number; unchanged: number; total: number; branchId: string; revisionId: string; runId: string; error?: never }
  | { error: string; newlyDenied?: never }
  | null;

async function verifyActiveWorkspaceWriteAccess(): Promise<{ error: string } | null> {
  const context = await getWorkspaceContext();
  const writeCheck = verifyWriteAccess(context.tenantId);
  return writeCheck.allowed ? null : { error: writeCheck.error || "Write access denied." };
}

export async function runSimulation(
  _prev: SimulationState,
  formData: FormData
): Promise<SimulationState> {
  const denied = await verifyActiveWorkspaceWriteAccess();
  if (denied) return denied;

  const branchId = (formData.get("branchId") as string | null) ?? "";
  const revisionId = (formData.get("revisionId") as string | null) ?? "";

  const result = await runSimulationDecision({ branchId, revisionId });
  if ("error" in result) {
    return result;
  }

  revalidatePaths(["/evidence", "/simulate"]);
  return result;
}

export type GenerateSimulationChangeState =
  | { error: string }
  | { ok: true; recommendation: SimulationChangeRecommendation }
  | null;

export async function generateSimulationChangeRecommendation(
  _prevState: GenerateSimulationChangeState,
  formData: FormData
): Promise<GenerateSimulationChangeState> {
  const denied = await verifyActiveWorkspaceWriteAccess();
  if (denied) return denied;

  const branchId = String(formData.get("branchId") ?? "").trim();
  const revisionId = String(formData.get("revisionId") ?? "").trim();
  const result = await generateSimulationChangeRecommendationDecision({
    branchId,
    revisionId,
  }, await getActiveScope().catch(() => null));
  if ("error" in result) return result;
  revalidatePaths(["/evidence", "/operations", "/simulate"]);
  return result;
}

export type ApplySimulationChangeState = { error: string } | { ok: true } | null;

export async function applySimulationChangeRecommendation(
  _prevState: ApplySimulationChangeState,
  formData: FormData
): Promise<ApplySimulationChangeState> {
  const denied = await verifyActiveWorkspaceWriteAccess();
  if (denied) return denied;

  const result = await applySimulationChangeDecision({
    decision: String(formData.get("decision") ?? "").trim(),
    rationale: String(formData.get("rationale") ?? "").trim() || undefined,
    recommendationId: String(formData.get("recommendationId") ?? "").trim() || undefined,
    branchId: String(formData.get("branchId") ?? "").trim() || undefined,
    revisionId: String(formData.get("revisionId") ?? "").trim() || undefined,
    runId: String(formData.get("runId") ?? "").trim() || undefined,
    recommendationSummary: String(formData.get("recommendationSummary") ?? "").trim() || undefined,
    editedSummary: String(formData.get("editedSummary") ?? "").trim() || undefined,
  }, await getActiveScope().catch(() => null));
  if ("error" in result) return result;
  revalidatePaths(["/evidence", "/operations", "/simulate"]);
  return result;
}
