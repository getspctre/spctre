import { ALL_REVIEWER_ROLES } from "@/lib/approval-config";
import { canActorReviewRole } from "@/lib/actors";
import type { ReviewActorResolver } from "./actor";
import type { ActiveScope } from "@/lib/workspace";
import {
  getApprovalById,
  getRevisionWorkspaceScope,
  upsertApprovalForRevision,
} from "@/lib/repositories/policy";
import { insertAuthorizationDenialEvent } from "@/lib/repositories/workspace";
import { listPendingApprovalQueue } from "@/lib/repositories/policy/review";
import { runWithTenantContext } from "@/lib/tenant-context";

export interface AddApprovalInput {
  revisionId: string;
  role: string;
  approvalStatus: string;
  note: string | null;
}

export type AddApprovalResult = { ok: true } | { error: string };

export async function addApprovalDecision(
  input: AddApprovalInput,
  scope: ActiveScope,
  resolveActor: ReviewActorResolver,
): Promise<AddApprovalResult> {
  if (!input.revisionId || !input.role || !input.approvalStatus) {
    return { error: "Review action is unavailable." };
  }
  if (!(ALL_REVIEWER_ROLES as readonly string[]).includes(input.role)) {
    return { error: "Reviewer role is invalid." };
  }
  if (!["APPROVED", "CHANGES_REQUESTED", "PENDING"].includes(input.approvalStatus)) {
    return { error: "Approval status is invalid." };
  }

  const workspaceContext = scope;
  const tenantId = workspaceContext.tenantId;

  // Bound here rather than by the caller: a bearer request has no tenant on the
  // connection until the token is authenticated, and every read below is
  // tenant-scoped. Binding the same tenant twice on the session path is a no-op.
  return runWithTenantContext(tenantId, async () => {
    const revisionRow = await getRevisionWorkspaceScope({ tenantId, revisionId: input.revisionId });
    if (!revisionRow) return { error: "Revision not found." };

    const { principalId, actor } = await resolveActor({
      workspaceId: revisionRow.workspace_id ?? workspaceContext.workspaceId,
      tenantId,
    });
    if (!actor) {
      await insertAuthorizationDenialEvent({
        tenantId,
        action: "approval.write",
        reason: "No permission grant for the acting principal.",
        resourceType: "policy_revision",
        resourceId: input.revisionId,
        principalId,
        workspaceId: revisionRow.workspace_id,
      });
      return { error: "No permission grants are configured for the acting principal." };
    }

    const workspaceSlug = revisionRow.workspace_slug ?? "workspace-demo";
    const reviewCheck = canActorReviewRole(actor, workspaceSlug, input.role);
    if (!reviewCheck.allowed) {
      await insertAuthorizationDenialEvent({
        tenantId,
        action: "approval.write",
        reason: reviewCheck.reason ?? "Review is not allowed.",
        resourceType: "policy_revision",
        resourceId: input.revisionId,
        principalId: actor.id,
        workspaceId: revisionRow.workspace_id,
      });
      return { error: reviewCheck.reason ?? "Review is not allowed." };
    }

    await upsertApprovalForRevision({
      tenantId,
      revisionId: input.revisionId,
      actorId: actor.id,
      role: input.role,
      approvalStatus: input.approvalStatus,
      note: input.note,
    });

    return { ok: true };
  });
}

export async function getApprovalDetail(params: {
  approvalId: string;
  workspaceId: string | null;
  tenantId: string;
}) {
  return runWithTenantContext(params.tenantId, () =>
    getApprovalById(params.approvalId, params.workspaceId, params.tenantId),
  );
}

export async function listPendingApprovals(params: { workspaceId: string; tenantId: string }) {
  return runWithTenantContext(params.tenantId, () =>
    listPendingApprovalQueue(params.workspaceId, params.tenantId),
  );
}
