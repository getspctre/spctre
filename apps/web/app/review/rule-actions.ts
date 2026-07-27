"use server";

import { revalidatePath } from "next/cache";
import {
  createDraftRuleRevisionDecision,
  commitRuleRevisionDecision,
  type DraftRevisionState as DomainDraftRevisionState,
  type CommitRevisionState as DomainCommitRevisionState,
} from "@/lib/domains/review/service";
import { getWorkspaceContext } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { evaluateDecision, validatePolicyControlMappings, type PolicyRuleSummary, type EvaluationResult } from "@spctre/policy-schema";
import { simulateDraftAgainstEvidence, type DraftSimulationSummary } from "@/lib/domains/review/draft-simulation";

export type DraftRevisionState = DomainDraftRevisionState;
export type CommitRevisionState = DomainCommitRevisionState;

export type DraftSimulationState =
  | { summary: DraftSimulationSummary; error?: never }
  | { error: string; summary?: never }
  | null;

// Preview the draft rule set's blast radius over recent retained evidence,
// without committing. Read-only and ephemeral — no persistence.
export async function simulateDraftDecision(
  _prev: DraftSimulationState,
  formData: FormData
): Promise<DraftSimulationState> {
  const workspaceContext = await getWorkspaceContext();
  const rulesPayload = String(formData.get("rulesPayload") ?? "").trim();

  let rules: PolicyRuleSummary[];
  try {
    const parsed = JSON.parse(rulesPayload || "[]");
    if (!Array.isArray(parsed)) return { error: "Draft rules are not a valid array." };
    rules = parsed as PolicyRuleSummary[];
  } catch {
    return { error: "Draft rules could not be read." };
  }

  try {
    const { summary } = await simulateDraftAgainstEvidence({
      rules,
      workspaceSlug: workspaceContext.workspaceSlug,
    });
    return { summary };
  } catch {
    return { error: "Could not run the simulation." };
  }
}

export type ExampleDecisionState =
  | { result: EvaluationResult; error?: never }
  | { error: string; result?: never }
  | null;

// Preview what the in-memory draft rule set would decide for an example
// tool-call, without committing. Deterministic and side-effect free — it runs
// the same evaluateDecision the gateway uses, over the draft payload the editor
// would commit, so the preview matches real enforcement.
export async function evaluateExampleDecision(
  _prev: ExampleDecisionState,
  formData: FormData
): Promise<ExampleDecisionState> {
  const rulesPayload = String(formData.get("rulesPayload") ?? "").trim();
  const connector = String(formData.get("connector") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim();
  const domains = String(formData.get("domains") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const toolIntent = String(formData.get("toolIntent") ?? "").trim();
  const parametersText = String(formData.get("toolParameters") ?? "").trim();

  if (!connector || !action) {
    return { error: "Enter a connector and an action to preview a decision." };
  }

  let rules: PolicyRuleSummary[];
  try {
    const parsed = JSON.parse(rulesPayload || "[]");
    if (!Array.isArray(parsed)) return { error: "Draft rules are not a valid array." };
    rules = parsed as PolicyRuleSummary[];
  } catch {
    return { error: "Draft rules could not be read." };
  }

  let toolParameters: Record<string, unknown> = {};
  if (parametersText) {
    try {
      const parsed = JSON.parse(parametersText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "Tool parameters must be a JSON object, e.g. { \"amount_cents\": 60000 }." };
      }
      toolParameters = parsed as Record<string, unknown>;
    } catch {
      return { error: "Tool parameters must be valid JSON." };
    }
  }

  const result = evaluateDecision({ connector, action, domains, rules, toolIntent, planSummary: toolIntent, toolParameters });
  return { result };
}

export async function createDraftRuleRevision(
  _prev: DraftRevisionState,
  formData: FormData
): Promise<DraftRevisionState> {
  const workspaceContext = await getWorkspaceContext();
  const tenantId = workspaceContext.tenantId;
  const writeCheck = verifyWriteAccess(tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const branchId = String(formData.get("branchId") ?? "").trim();
  const baseRevisionId = String(formData.get("baseRevisionId") ?? "").trim();
  const message = String(formData.get("message") ?? "Create persisted draft revision").trim();

  if (!branchId || !baseRevisionId) return { error: "Missing branch or base revision." };

  const result = await createDraftRuleRevisionDecision({
    branchId,
    baseRevisionId,
    message,
    workspaceSlug: workspaceContext.workspaceSlug,
  });

  if (!result || "error" in result) {
    return result;
  }

  revalidatePath("/");
  revalidatePath("/review");

  return result;
}

export async function commitRuleRevision(
  _prev: CommitRevisionState,
  formData: FormData
): Promise<CommitRevisionState> {
  const workspaceContext = await getWorkspaceContext();
  const tenantId = workspaceContext.tenantId;
  const writeCheck = verifyWriteAccess(tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const branchId = String(formData.get("branchId") ?? "").trim();
  const parentRevisionId = String(formData.get("parentRevisionId") ?? "").trim();
  const sourcePath = String(formData.get("sourcePath") ?? "ui/review-rule-editor").trim();
  const message = String(formData.get("message") ?? "Commit via in-app rule editor").trim();
  const rulesPayload = String(formData.get("rulesPayload") ?? "").trim();

  if (!branchId || !parentRevisionId) return { error: "Missing branch or parent revision." };
  if (!rulesPayload) return { error: "No authored rules were provided." };
  try {
    const parsedRules = JSON.parse(rulesPayload);
    if (!Array.isArray(parsedRules)) return { error: "Authored rules must be an array." };
    const mappingIssues = validatePolicyControlMappings(parsedRules as PolicyRuleSummary[]);
    if (mappingIssues.length) return { error: `Control mappings require attention: ${mappingIssues.map((issue) => `${issue.stableRuleId}: ${issue.message}`).join(" ")}` };
  } catch {
    return { error: "Authored rules are not valid JSON." };
  }

  const result = await commitRuleRevisionDecision({
    branchId,
    parentRevisionId,
    sourcePath,
    message,
    rulesPayload,
    workspaceSlug: workspaceContext.workspaceSlug,
  });

  if (!result || "error" in result) {
    return result;
  }

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");
  revalidatePath("/agents");
  revalidatePath("/compliance");

  return result;
}
