import { logger } from "@spctre/platform/logging";
import { redirect } from "next/navigation";
import { canGrantRole, isOrgRole, roleDefinition, type OrgRole } from "@/lib/rbac";
import {
  listOrganizationMembers,
  listRecentRbacAuditEvents,
  listTenantWorkspaces,
  getActorOrgRole,
  getPrincipalBySubject,
  getPrincipalOrgRole,
  verifyWorkspaceAccess,
  auditRbacAndLifecycle,
  upsertPrincipalGrant,
  upsertOrganizationInvite,
  updatePrincipalOrgRole,
  deletePrincipalWorkspaceGrant,
  revokeInvite,
  removeOrganizationMember,
} from "@/lib/repositories/members";
import { getWorkspaceContext } from "@/lib/workspace";
import { requireAdminActor, checkWriteAccess } from "../shared/guard";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { sendMemberInviteEmail } from "@/lib/email";

export type { OrganizationMember, WorkspaceSummary } from "@/lib/repositories/members";

export interface MembersPageModel {
  workspaceContext: Awaited<ReturnType<typeof getWorkspaceContext>>;
  actor: NonNullable<Awaited<ReturnType<typeof findActorById>>>;
  members: Awaited<ReturnType<typeof listOrganizationMembers>>;
  workspaces: Awaited<ReturnType<typeof listTenantWorkspaces>>;
  auditEvents: Awaited<ReturnType<typeof listRecentRbacAuditEvents>>;
  session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;
}

export async function getMembersPageModel(): Promise<MembersPageModel> {
  const workspaceContext = await getWorkspaceContext();
  const session = await getAuthSession().catch(() => null);
  if (!session) redirect("/login");

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspaceContext.workspaceId,
  }).catch(() => null);
  if (!actor?.reviewerRoles.includes("Admin")) {
    redirect("/?error=admin-required");
  }

  const [members, workspaces, auditEvents] = await Promise.all([
    listOrganizationMembers(session.tenantId),
    listTenantWorkspaces(session.tenantId),
    listRecentRbacAuditEvents(session.tenantId, 8),
  ]);

  return {
    workspaceContext,
    actor,
    members,
    workspaces,
    auditEvents,
    session,
  };
}

export async function listOrganizationMembersForApi(tenantId: string) {
  return listOrganizationMembers(tenantId);
}

export type MemberActionState =
  | { ok: true; message: string; error?: never }
  | { ok?: never; message?: never; error: string }
  | null;

async function requireMemberAdmin() {
  const guard = await requireAdminActor();
  if ("error" in guard) return guard;

  const actorOrgRole = await getActorOrgRole({
    tenantId: guard.session.tenantId,
    principalId: guard.session.principalId,
  });

  return { session: guard.session, actorOrgRole } as const;
}

export async function inviteOrganizationMemberDecision(params: {
  displayName: string;
  email: string;
  orgRole: OrgRole | null;
}): Promise<MemberActionState> {
  const guard = await requireMemberAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const { displayName, email, orgRole } = params;

  if (!displayName) return { error: "Display name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "A valid email address is required." };
  if (!orgRole) return { error: "Select a built-in organization role." };
  if (!canGrantRole(guard.actorOrgRole, orgRole)) return { error: "You cannot assign a role higher than your own." };

  const subject = email.trim().toLowerCase();

  const existingRow = await getPrincipalBySubject({ tenantId: guard.session.tenantId, subject });
  if (existingRow) {
    const existingRole = isOrgRole(existingRow.org_role) ? existingRow.org_role as OrgRole : null;
    if (existingRole && !canGrantRole(guard.actorOrgRole, existingRole)) {
      return { error: "You cannot modify a member with a higher role than your own." };
    }
  }

  const principalResult = await upsertOrganizationInvite({
    tenantId: guard.session.tenantId,
    subject,
    displayName,
    email,
    orgRole,
    invitedBy: guard.session.principalId,
  });
  const principalId = principalResult?.id;
  if (!principalId) return { error: "Unable to create member invite." };

  await upsertPrincipalGrant({
    tenantId: guard.session.tenantId,
    principalId,
    workspaceId: null,
    role: orgRole,
  });

  await auditRbacAndLifecycle({
    tenantId: guard.session.tenantId,
    actorId: guard.session.principalId,
    targetPrincipalId: principalId,
    action: "INVITE_CREATED",
    detail: { email, orgRole, roleSummary: roleDefinition(orgRole).summary },
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.SPCTRE_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login?email=${encodeURIComponent(subject)}`;
  sendMemberInviteEmail({
    to: email,
    inviterName: guard.session.principalId,
    role: roleDefinition(orgRole).label,
    loginUrl,
  }).catch((err) => {
    logger.error("[members] invite email delivery failed", { error: err instanceof Error ? err.message : String(err) });
  });

  return {
    ok: true,
    message: principalResult?.created
      ? `Created invite for ${email}.`
      : `Updated invite and role for ${email}.`,
  };
}

export async function updateMemberOrgRoleDecision(params: {
  principalId: string;
  orgRole: OrgRole | null;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await requireMemberAdmin();
  if ("error" in guard) return { error: "Insufficient privileges." };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: "Write access denied." };

  const { principalId, orgRole } = params;
  if (!principalId || !orgRole) return { error: "Invalid parameters." };
  if (!canGrantRole(guard.actorOrgRole, orgRole)) return { error: "You cannot grant this role." };

  const targetRow = await getPrincipalOrgRole({ tenantId: guard.session.tenantId, principalId });
  const targetRole = isOrgRole(targetRow?.org_role ?? "") ? targetRow!.org_role as OrgRole : null;
  if (!targetRole) return { error: "Member not found." };
  if (!canGrantRole(guard.actorOrgRole, targetRole)) return { error: "Insufficient privileges to modify this member." };

  await updatePrincipalOrgRole({ tenantId: guard.session.tenantId, principalId, orgRole });
  await upsertPrincipalGrant({
    tenantId: guard.session.tenantId,
    principalId,
    workspaceId: null,
    role: orgRole,
  });
  await auditRbacAndLifecycle({
    tenantId: guard.session.tenantId,
    actorId: guard.session.principalId,
    targetPrincipalId: principalId,
    action: "MEMBER_ROLE_UPDATED",
    detail: { orgRole },
  });
  return { ok: true };
}

export async function updateWorkspaceOverrideDecision(params: {
  principalId: string;
  workspaceId: string;
  roleRaw: string;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await requireMemberAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const { principalId, workspaceId, roleRaw } = params;
  if (!principalId || !workspaceId) return { error: "Member and workspace are required." };

  const workspaceOk = await verifyWorkspaceAccess({ tenantId: guard.session.tenantId, workspaceId });
  if (!workspaceOk) return { error: "Workspace is not available." };

  const targetPrincipalRow = await getPrincipalOrgRole({ tenantId: guard.session.tenantId, principalId });
  const targetPrincipalRole = isOrgRole(targetPrincipalRow?.org_role ?? "") ? targetPrincipalRow!.org_role as OrgRole : null;
  if (!targetPrincipalRole || !canGrantRole(guard.actorOrgRole, targetPrincipalRole)) {
    return { error: "Insufficient privileges to modify this member." };
  }

  if (roleRaw === "INHERIT") {
    await deletePrincipalWorkspaceGrant({ tenantId: guard.session.tenantId, principalId, workspaceId });
    await auditRbacAndLifecycle({
      tenantId: guard.session.tenantId,
      workspaceId,
      actorId: guard.session.principalId,
      targetPrincipalId: principalId,
      action: "WORKSPACE_OVERRIDE_REMOVED",
      detail: {},
    });
    return { ok: true };
  }

  if (isOrgRole(roleRaw) && canGrantRole(guard.actorOrgRole, roleRaw)) {
    await upsertPrincipalGrant({
      tenantId: guard.session.tenantId,
      principalId,
      workspaceId,
      role: roleRaw,
    });
    await auditRbacAndLifecycle({
      tenantId: guard.session.tenantId,
      workspaceId,
      actorId: guard.session.principalId,
      targetPrincipalId: principalId,
      action: "WORKSPACE_OVERRIDE_UPDATED",
      detail: { workspaceRole: roleRaw },
    });
    return { ok: true };
  }

  return { error: "Select a workspace role you are allowed to grant." };
}

export async function revokeMemberInviteDecision(params: {
  principalId: string;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await requireMemberAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const { principalId } = params;
  if (!principalId) return { error: "Member is missing." };

  await revokeInvite({ tenantId: guard.session.tenantId, principalId });
  await auditRbacAndLifecycle({
    tenantId: guard.session.tenantId,
    actorId: guard.session.principalId,
    targetPrincipalId: principalId,
    action: "INVITE_REVOKED",
    detail: {},
  });
  return { ok: true };
}

export async function removeOrganizationMemberDecision(params: {
  principalId: string;
}): Promise<{ ok: true } | { error: string }> {
  const guard = await requireMemberAdmin();
  if ("error" in guard) return { error: guard.error };

  const writeCheck = checkWriteAccess(guard.session.tenantId);
  if ("error" in writeCheck) return { error: writeCheck.error };

  const { principalId } = params;
  if (!principalId) return { error: "Member is missing." };
  if (principalId === guard.session.principalId) return { error: "You cannot remove your own membership from this screen." };

  await removeOrganizationMember({ tenantId: guard.session.tenantId, principalId });
  await auditRbacAndLifecycle({
    tenantId: guard.session.tenantId,
    actorId: guard.session.principalId,
    targetPrincipalId: principalId,
    action: "MEMBER_REMOVED",
    detail: {},
  });
  return { ok: true };
}
