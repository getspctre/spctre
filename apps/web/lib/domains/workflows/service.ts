import { redirect } from "next/navigation";
import type { ActiveScope } from "@/lib/workspace";
import { REVIEWER_ROLES } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { requireAdminActor, checkWriteAccess } from "../shared/guard";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import {
  listApprovalWorkflows,
  listApprovalWorkflowAuditEvents,
  insertWorkflowAuditEvent,
  deleteActiveApprovals,
  verifyWorkspaceForWorkflow,
  getExistingWorkflowForScope,
  getWorkflowRiskTags,
  upsertWorkflowConfig,
  getNextWorkflowRuleSequence,
  upsertWorkflowRule,
  getWorkflowForDisable,
  countEnabledWorkflows,
  disableWorkflowById,
  getWorkflowScopeById,
  deleteWorkflowRuleById,
  getApprovalWorkflowForContext,
  type ApprovalWorkflowConfigSummary,
} from "@/lib/repositories/approval-workflow";
import { listTenantWorkspaces } from "@/lib/repositories/members";
import { swallow } from "@/lib/platform/swallow";

export type { ApprovalWorkflowConfigSummary };

export interface WorkflowsPageModel {
  workspaceContext: ActiveScope;
  actor: NonNullable<Awaited<ReturnType<typeof findActorById>>>;
  workflows: Awaited<ReturnType<typeof listApprovalWorkflows>>;
  workspaces: Awaited<ReturnType<typeof listTenantWorkspaces>>;
  auditEvents: Awaited<ReturnType<typeof listApprovalWorkflowAuditEvents>>;
  enabledCount: number;
}

export async function getWorkflowsPageModel(scope: ActiveScope): Promise<WorkflowsPageModel> {
  const workspaceContext = scope;
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) redirect("/login");

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspaceContext.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) {
    redirect("/?error=admin-required");
  }

  const [workflows, workspaces, auditEvents] = await Promise.all([
    listApprovalWorkflows(session.tenantId),
    listTenantWorkspaces(session.tenantId),
    listApprovalWorkflowAuditEvents(session.tenantId, 8),
  ]);
  const enabledCount = workflows.filter((workflow) => workflow.enabled).length;

  return {
    workspaceContext,
    actor,
    workflows,
    workspaces,
    auditEvents,
    enabledCount,
  };
}

export async function getApprovalWorkflowConfig(params: {
  tenantId: string;
  workspaceId: string;
  environment: string | null;
}) {
  return getApprovalWorkflowForContext(params);
}

export type WorkflowActionState =
  | { ok: true; message: string; error?: never }
  | { ok?: never; message?: never; error: string }
  | null;

const VALID_REVIEW_MODES = new Set(["PARALLEL", "SEQUENTIAL"]);
const VALID_REVIEWER_ROLES = new Set<string>(REVIEWER_ROLES);
const REQUIRE_AGT_VERIFICATION_TAG = "verification:require-agt";
const ALLOW_IMMEDIATE_PACK_PUBLISH_TAG = "pack:allow-immediate-publish";

async function requireWorkflowAdmin() {
  return requireAdminActor();
}

function selectedRoles(formData: FormData): string[] {
  return Array.from(
    new Set(
      formData
        .getAll("eligibleRole")
        .map((value) => String(value).trim())
        .filter((value) => VALID_REVIEWER_ROLES.has(value))
    )
  );
}

interface ParsedWorkflowForm {
  workflowId: string;
  name: string;
  workspaceId: string | null;
  environment: string | null;
  reviewMode: string;
  requireVerification: boolean;
  allowImmediatePackPublish: boolean;
  role: string;
  requiredCount: number;
  eligibleRoles: string[];
}

function parseWorkflowForm(formData: FormData): ParsedWorkflowForm {
  const workspaceRaw = String(formData.get("workspaceId") ?? "").trim();
  const environmentRaw = String(formData.get("environment") ?? "").trim();
  const reviewModeRaw = String(formData.get("reviewMode") ?? "PARALLEL")
    .trim()
    .toUpperCase();

  return {
    workflowId: String(formData.get("workflowId") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    workspaceId: workspaceRaw === "TENANT" ? null : workspaceRaw,
    environment: environmentRaw || null,
    reviewMode: VALID_REVIEW_MODES.has(reviewModeRaw) ? reviewModeRaw : "PARALLEL",
    requireVerification: String(formData.get("requireVerification") ?? "").trim() === "on",
    allowImmediatePackPublish: String(formData.get("allowImmediatePackPublish") ?? "").trim() === "on",
    role: String(formData.get("role") ?? "").trim(),
    requiredCount: Number.parseInt(String(formData.get("requiredCount") ?? "1"), 10),
    eligibleRoles: selectedRoles(formData),
  };
}

function validateWorkflowForm(form: ParsedWorkflowForm): string | null {
  if (!form.name) return "Workflow name is required.";
  if (!VALID_REVIEWER_ROLES.has(form.role)) return "Select a reviewer role for the rule.";
  if (!Number.isFinite(form.requiredCount) || form.requiredCount < 1 || form.requiredCount > 10) {
    return "Required approver count must be between 1 and 10.";
  }
  if (!form.eligibleRoles.length) return "Select at least one eligible reviewer role.";
  return null;
}

export async function upsertApprovalWorkflowDecision(
  formData: FormData
): Promise<WorkflowActionState> {
  const guard = await requireWorkflowAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const form = parseWorkflowForm(formData);
  const {
    workflowId,
    name,
    workspaceId,
    environment,
    reviewMode,
    requireVerification,
    allowImmediatePackPublish,
    role,
    requiredCount,
    eligibleRoles,
  } = form;

  const validationError = validateWorkflowForm(form);
  if (validationError) return { error: validationError };

  if (workspaceId) {
    const ok = await verifyWorkspaceForWorkflow({ tenantId: guard.session.tenantId, workspaceId });
    if (!ok) return { error: "Selected workspace is not available." };
  }

  const existingWorkflowId = workflowId
    ? ""
    : (await getExistingWorkflowForScope({
        tenantId: guard.session.tenantId,
        workspaceId,
        environment,
      })) ?? "";
  const targetWorkflowId = workflowId || existingWorkflowId;

  const existingRiskTags = targetWorkflowId
    ? await getWorkflowRiskTags({
        tenantId: guard.session.tenantId,
        workflowId: targetWorkflowId,
      })
    : [];
  const preservedRiskTags = existingRiskTags.filter(
    (tag) => tag !== REQUIRE_AGT_VERIFICATION_TAG && tag !== ALLOW_IMMEDIATE_PACK_PUBLISH_TAG
  );
  const riskTags = [
    ...preservedRiskTags,
    ...(requireVerification ? [REQUIRE_AGT_VERIFICATION_TAG] : []),
    ...(allowImmediatePackPublish ? [ALLOW_IMMEDIATE_PACK_PUBLISH_TAG] : []),
  ];

  const savedWorkflowId = await upsertWorkflowConfig({
    tenantId: guard.session.tenantId,
    workflowId: targetWorkflowId,
    name,
    workspaceId,
    environment,
    reviewMode,
    riskTags,
    actorId: guard.session.principalId,
  });
  if (!savedWorkflowId) return { error: "Unable to save approval workflow." };

  const sequence = await getNextWorkflowRuleSequence(savedWorkflowId);
  await upsertWorkflowRule({
    workflowId: savedWorkflowId,
    sequence,
    role,
    requiredCount,
    eligibleRoles,
  });

  const refreshedItems = await deleteActiveApprovals({
    tenantId: guard.session.tenantId,
    workspaceId,
    environment,
  });

  await insertWorkflowAuditEvent({
    tenantId: guard.session.tenantId,
    workspaceId,
    workflowId: savedWorkflowId,
    actorId: guard.session.principalId,
    action: targetWorkflowId ? "WORKFLOW_UPDATED" : "WORKFLOW_CREATED",
    detail: {
      name,
      environment,
      reviewMode,
      requireVerification,
      allowImmediatePackPublish,
      role,
      requiredCount,
      eligibleRoles,
      refreshedItems,
    },
  });

  revalidatePath("/admin/workflows");
  revalidatePath("/review");
  revalidatePath("/compliance");
  return { ok: true, message: "Approval workflow saved." };
}

export async function disableApprovalWorkflowDecision(
  formData: FormData
): Promise<WorkflowActionState> {
  const guard = await requireWorkflowAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const workflowId = String(formData.get("workflowId") ?? "").trim();
  if (!workflowId) return { error: "Workflow id is required." };

  const target = await getWorkflowForDisable({ tenantId: guard.session.tenantId, workflowId });
  if (!target) return { error: "Workflow not found." };

  if (target.enabled) {
    const enabledCount = await countEnabledWorkflows(guard.session.tenantId);
    if (enabledCount <= 1) {
      return { error: "Cannot disable the only active workflow. Keep at least one workflow enabled." };
    }
  }

  const returnedWorkspaceId = await disableWorkflowById({
    tenantId: guard.session.tenantId,
    workflowId,
    actorId: guard.session.principalId,
  });

  const refreshedItems = await deleteActiveApprovals({
    tenantId: guard.session.tenantId,
    workspaceId: target.workspace_id,
    environment: target.environment,
  });

  await insertWorkflowAuditEvent({
    tenantId: guard.session.tenantId,
    workspaceId: returnedWorkspaceId ?? null,
    workflowId,
    actorId: guard.session.principalId,
    action: "WORKFLOW_DISABLED",
    detail: { refreshedItems },
  });

  revalidatePath("/admin/workflows");
  revalidatePath("/review");
  revalidatePath("/compliance");
  return { ok: true, message: `Workflow disabled. Refreshed ${refreshedItems} active review item(s).` };
}

export async function removeApprovalWorkflowRuleDecision(
  formData: FormData
): Promise<WorkflowActionState> {
  const guard = await requireWorkflowAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const ruleId = String(formData.get("ruleId") ?? "").trim();
  const workflowId = String(formData.get("workflowId") ?? "").trim();
  if (!ruleId || !workflowId) return { error: "Workflow id and rule id are required." };

  const workflow = await getWorkflowScopeById({ tenantId: guard.session.tenantId, workflowId });

  await deleteWorkflowRuleById({ tenantId: guard.session.tenantId, workflowId, ruleId });

  const refreshedItems = workflow
    ? await deleteActiveApprovals({
        tenantId: guard.session.tenantId,
        workspaceId: workflow.workspace_id,
        environment: workflow.environment,
      })
    : 0;

  await insertWorkflowAuditEvent({
    tenantId: guard.session.tenantId,
    workflowId,
    actorId: guard.session.principalId,
    action: "RULE_REMOVED",
    detail: { ruleId, refreshedItems },
  });

  revalidatePath("/admin/workflows");
  revalidatePath("/review");
  revalidatePath("/compliance");
  return { ok: true, message: `Rule removed. Refreshed ${refreshedItems} active review item(s).` };
}
