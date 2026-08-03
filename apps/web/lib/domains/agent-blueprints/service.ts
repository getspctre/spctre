import type { AgentBlueprintDefinition, AgentBlueprintStatus, RuntimeTarget } from "@spctre/policy-schema";
import { evaluatePublishReadiness } from "@spctre/policy-schema";
import { approvalRulesFromWorkflow, getApprovalWorkflowForContext } from "@/lib/repositories/approval-workflow";
import { logger } from "@spctre/platform/logging";
import { getAgentBlueprintApprovals, upsertAgentBlueprintApproval } from "@/lib/repositories/agent-blueprints";
import {
  createAgentBlueprint,
  createAgentBlueprintRevision,
  getAgentBlueprint,
  getAgentBlueprintByAgent,
  getAgentBlueprintWorkspaceScope,
  getPublishedAgentBlueprintRuntime,
  getPublishedAgentBlueprintRuntimeByAgent as getPublishedAgentBlueprintRuntimeByAgentInTenant,
  hashBlueprintDefinition,
  listAgentBlueprints,
  rollbackAgentBlueprint,
  simulateAgentBlueprintRevision,
  setAgentBlueprintRevisionStatus,
} from "@/lib/repositories/agent-blueprints";
import { getPublishedPolicyBranchByName } from "@/lib/repositories/policy";
import { runWithTenantContext } from "@/lib/tenant-context";

export async function getPublishedAgentBlueprintRuntimeByAgent(
  params: Parameters<typeof getPublishedAgentBlueprintRuntimeByAgentInTenant>[0]
) {
  return runWithTenantContext(params.tenantId, () => getPublishedAgentBlueprintRuntimeByAgentInTenant(params));
}

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

export type ImportBlueprintForTokenResult =
  | {
      result: {
        blueprintId: string;
        revisionId: string;
        definitionHash: string;
        created: boolean;
        alreadyCurrent: boolean;
        policyBranchId: string;
        policyRevisionId: string;
      };
    }
  | { error: string; status: number };

/**
 * Authenticated, idempotent Blueprint import for automation/CI (operator
 * identity, `blueprint:import` scope). Drafts a DRAFT Blueprint/revision only —
 * it never approves or publishes.
 *
 * The source names its governing policy branch via `definition.policyBranchId`
 * (a branch NAME) and never pins a revision. This resolves the branch's
 * currently-published revision and pins it into the draft, failing closed if the
 * branch has no published revision. Re-importing an unchanged, same-bound
 * definition is a no-op; a changed definition (including a re-bind after a policy
 * re-publish) appends a new DRAFT revision.
 */
export async function importBlueprintForToken(input: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  name: string;
  agentId: string;
  message: string;
  definition: unknown;
}): Promise<ImportBlueprintForTokenResult> {
  if (!input.name.trim()) return { error: "Blueprint name is required.", status: 400 };
  if (!input.agentId.trim()) return { error: "Blueprint agentId is required.", status: 400 };

  const parsed = parseAgentBlueprintDefinition(input.definition);
  if (!parsed.definition) return { error: parsed.error ?? "Invalid Blueprint definition.", status: 400 };
  const definition = parsed.definition;

  const branchName = definition.policyBranchId?.trim();
  if (!branchName) {
    return { error: "definition.policyBranchId (the connector policy branch name) is required for import.", status: 400 };
  }

  try {
    return await runWithTenantContext(input.tenantId, async (): Promise<ImportBlueprintForTokenResult> => {
      // Fail closed: bind only to a branch that already has a PUBLISHED revision.
      const published = await getPublishedPolicyBranchByName({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        branchName,
      });
      if (!published) {
        return {
          error: `Policy branch "${branchName}" has no published revision; publish the policy first, then import the Blueprint.`,
          status: 409,
        };
      }

      // Pin the resolved, immutable binding. The hash covers the bound revision,
      // so a re-import after a policy re-publish yields a fresh draft revision.
      const boundDefinition: AgentBlueprintDefinition = {
        ...definition,
        policyBranchId: published.branchId,
        policyRevisionId: published.revisionId,
      };
      const definitionHash = hashBlueprintDefinition(boundDefinition);

      let existing = await getAgentBlueprintByAgent({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      });

      if (!existing) {
        const created = await createAgentBlueprint({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          name: input.name,
          agentId: input.agentId,
          message: input.message,
          definition: boundDefinition,
          authorId: input.principalId,
        });
        if (created) {
          return {
            result: {
              blueprintId: created.id,
              revisionId: created.activeRevisionId,
              definitionHash,
              created: true,
              alreadyCurrent: false,
              policyBranchId: published.branchId,
              policyRevisionId: published.revisionId,
            },
          };
        }
        // Create failed on a unique violation. Re-read by agent: a concurrent
        // first-ever import may have just created the Blueprint (the agent-id
        // unique constraint let only one win) — fall through to the head-check /
        // append path so the loser converges instead of returning 409. If no
        // Blueprint governs this agent, the conflict was on the name, which is a
        // genuine 409.
        existing = await getAgentBlueprintByAgent({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agentId: input.agentId,
        });
        if (!existing) {
          return { error: "Blueprint could not be created; its name may already be in use.", status: 409 };
        }
      }

      // Idempotency is HEAD-based: no-op only when the current head (active
      // revision) already carries this exact bound definition. A definition that
      // merely appeared in some *historical* revision must still append a fresh
      // draft — e.g. a source rollback A→B→A after both A and B were published.
      // Runtime selects the latest-PUBLISHED revision by published_at, so reusing
      // the old, already-PUBLISHED A could never converge (it cannot be
      // republished, and B stays selected). Appending a new draft lets the
      // operator publish it and make A live again.
      if (existing.activeDefinitionHash === definitionHash) {
        return {
          result: {
            blueprintId: existing.id,
            revisionId: existing.activeRevisionId ?? "",
            definitionHash,
            created: false,
            alreadyCurrent: true,
            policyBranchId: published.branchId,
            policyRevisionId: published.revisionId,
          },
        };
      }

      const revision = await createAgentBlueprintRevision({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        blueprintId: existing.id,
        authorId: input.principalId,
        message: input.message,
        definition: boundDefinition,
      });
      if (revision) {
        return {
          result: {
            blueprintId: existing.id,
            revisionId: revision.id,
            definitionHash,
            created: false,
            alreadyCurrent: false,
            policyBranchId: published.branchId,
            policyRevisionId: published.revisionId,
          },
        };
      }

      // createAgentBlueprintRevision no-ops (null) when the head already carries
      // this definition — which, given our earlier head check passed, means a
      // concurrent import appended it under the row lock between the two. Re-read
      // and report it as already current rather than a spurious failure.
      const afterRace = await getAgentBlueprintByAgent({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      });
      if (afterRace && afterRace.activeDefinitionHash === definitionHash) {
        return {
          result: {
            blueprintId: afterRace.id,
            revisionId: afterRace.activeRevisionId ?? "",
            definitionHash,
            created: false,
            alreadyCurrent: true,
            policyBranchId: published.branchId,
            policyRevisionId: published.revisionId,
          },
        };
      }
      return { error: "Blueprint revision could not be created.", status: 500 };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[importBlueprintForToken] import failed:", { error: message });
    return { error: "An unexpected error occurred. Please try again.", status: 500 };
  }
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

export { createAgentBlueprint, createAgentBlueprintRevision, getAgentBlueprint, getAgentBlueprintWorkspaceScope, getPublishedAgentBlueprintRuntime, listAgentBlueprints, setAgentBlueprintRevisionStatus, getAgentBlueprintApprovals };
export type { AgentBlueprintStatus };
