"use server";

import {
  upsertApprovalWorkflowDecision,
  disableApprovalWorkflowDecision,
  removeApprovalWorkflowRuleDecision,
  type WorkflowActionState,
} from "@/lib/domains/workflows/service";

export type { WorkflowActionState };

export async function upsertApprovalWorkflow(
  _prev: WorkflowActionState,
  formData: FormData
): Promise<WorkflowActionState> {
  return upsertApprovalWorkflowDecision(formData);
}

export async function disableApprovalWorkflow(
  _prev: WorkflowActionState,
  formData: FormData
): Promise<WorkflowActionState> {
  return disableApprovalWorkflowDecision(formData);
}

export async function removeApprovalWorkflowRule(
  _prev: WorkflowActionState,
  formData: FormData
): Promise<WorkflowActionState> {
  return removeApprovalWorkflowRuleDecision(formData);
}
