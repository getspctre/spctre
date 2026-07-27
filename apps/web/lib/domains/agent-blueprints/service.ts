import type { AgentBlueprintDefinition, AgentBlueprintStatus, RuntimeTarget } from "@spctre/policy-schema";
import { evaluatePublishReadiness } from "@spctre/policy-schema";
import { approvalRulesFromWorkflow, getApprovalWorkflowForContext } from "@/lib/repositories/approval-workflow";
import { getAgentBlueprintApprovals, upsertAgentBlueprintApproval } from "@/lib/repositories/agent-blueprints";
import {
  createAgentBlueprint,
  createAgentBlueprintRevision,
  getAgentBlueprint,
  getPublishedAgentBlueprintRuntime,
  getPublishedAgentBlueprintRuntimeByAgent,
  listAgentBlueprints,
  rollbackAgentBlueprint,
  simulateAgentBlueprintRevision,
  setAgentBlueprintRevisionStatus,
} from "@/lib/repositories/agent-blueprints";

function normalizedStrings(value: unknown, field: string, issues: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    issues.push(`${field} must be an array of non-empty strings.`);
    return [];
  }
  return value.map((item) => item.trim());
}

function runtimeTargets(value: unknown, issues: string[]): RuntimeTarget[] {
  if (!Array.isArray(value)) {
    issues.push("runtimeTargets must be an array of runtime target objects.");
    return [];
  }
  const targets: RuntimeTarget[] = [];
  for (const target of value) {
    if (!target || typeof target !== "object" || Array.isArray(target) || typeof (target as Record<string, unknown>).stack !== "string") {
      issues.push("Each runtimeTargets item must include a stack string.");
      continue;
    }
    const record = target as Record<string, unknown>;
    targets.push({
      stack: record.stack as RuntimeTarget["stack"],
      ...(typeof record.adapter === "string" ? { adapter: record.adapter } : {}),
      ...(typeof record.environment === "string" ? { environment: record.environment } : {}),
      ...(typeof record.sandboxName === "string" ? { sandboxName: record.sandboxName } : {}),
      ...(typeof record.inferenceProvider === "string" ? { inferenceProvider: record.inferenceProvider } : {}),
    });
  }
  return targets;
}

export function parseAgentBlueprintDefinition(value: unknown): { definition?: AgentBlueprintDefinition; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "definition must be an object." };
  const record = value as Record<string, unknown>;
  const issues: string[] = [];
  const purpose = typeof record.purpose === "string" ? record.purpose.trim() : "";
  if (!purpose) issues.push("purpose is required.");
  const definition: AgentBlueprintDefinition = {
    purpose,
    allowedTaskClasses: normalizedStrings(record.allowedTaskClasses, "allowedTaskClasses", issues),
    tools: normalizedStrings(record.tools, "tools", issues),
    connectors: normalizedStrings(record.connectors, "connectors", issues),
    services: normalizedStrings(record.services, "services", issues),
    environments: normalizedStrings(record.environments, "environments", issues),
    runtimeTargets: runtimeTargets(record.runtimeTargets, issues),
  };
  if (record.approvalPath !== undefined) definition.approvalPath = normalizedStrings(record.approvalPath, "approvalPath", issues);
  if (typeof record.policyBranchId === "string" && record.policyBranchId.trim()) definition.policyBranchId = record.policyBranchId.trim();
  if (typeof record.policyRevisionId === "string" && record.policyRevisionId.trim()) definition.policyRevisionId = record.policyRevisionId.trim();
  if (record.budgets !== undefined) {
    if (!record.budgets || typeof record.budgets !== "object" || Array.isArray(record.budgets)) {
      issues.push("budgets must be an object.");
    } else {
      const budgets = record.budgets as Record<string, unknown>;
      const allowed = ["maxTokensPerTurn", "maxCostUsdPerSession", "maxToolCallsPerSession"] as const;
      const parsed = Object.fromEntries(allowed.flatMap((key) => {
        const value = budgets[key];
        if (value === undefined) return [];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          issues.push(`budgets.${key} must be a non-negative number.`);
          return [];
        }
        return [[key, value]];
      }));
      definition.budgets = parsed;
    }
  }
  return issues.length ? { error: issues.join(" ") } : { definition };
}

export async function submitBlueprintApproval(input: {
  tenantId: string; workspaceId: string; blueprintId: string; revisionId: string; reviewerId: string; reviewerRole: string; status: "APPROVED" | "CHANGES_REQUESTED" | "PENDING"; note?: string | null;
}) {
  return upsertAgentBlueprintApproval(input);
}

export async function publishBlueprintRevision(input: {
  tenantId: string; workspaceId: string; blueprintId: string; revisionId: string;
}) {
  const [workflow, approvals] = await Promise.all([
    getApprovalWorkflowForContext({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
    getAgentBlueprintApprovals({ tenantId: input.tenantId, revisionId: input.revisionId }),
  ]);
  const readiness = evaluatePublishReadiness({
    branchId: input.blueprintId,
    revisionId: input.revisionId,
    approvalRules: approvalRulesFromWorkflow(workflow),
    approvals,
    approvalWorkflow: workflow,
  });
  if (readiness.status !== "READY") return { error: readiness.blockingReasons.map((reason) => reason.message).join(" ") };
  const revision = await setAgentBlueprintRevisionStatus({ ...input, status: "PUBLISHED" });
  return revision ? { revision } : { error: "Blueprint is not ready to publish; verify its linked policy is published." };
}

export { rollbackAgentBlueprint };
export { simulateAgentBlueprintRevision };

export { createAgentBlueprint, createAgentBlueprintRevision, getAgentBlueprint, getPublishedAgentBlueprintRuntime, getPublishedAgentBlueprintRuntimeByAgent, listAgentBlueprints, setAgentBlueprintRevisionStatus, getAgentBlueprintApprovals };
export type { AgentBlueprintStatus };
