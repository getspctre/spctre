"use server";

import { revalidatePath } from "next/cache";
import { isOrgRole, type OrgRole } from "@/lib/rbac";
import {
  inviteOrganizationMemberDecision,
  updateMemberOrgRoleDecision,
  updateWorkspaceOverrideDecision,
  revokeMemberInviteDecision,
  removeOrganizationMemberDecision,
  type MemberActionState,
} from "@/lib/domains/members/service";

function parseRole(formData: FormData, key: string): OrgRole | null {
  const value = String(formData.get(key) ?? "")
    .trim()
    .toUpperCase();
  return isOrgRole(value) ? value : null;
}

export async function inviteOrganizationMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const orgRole = parseRole(formData, "orgRole");

  const result = await inviteOrganizationMemberDecision({ displayName, email, orgRole });

  if (result?.ok) {
    revalidatePath("/admin/members");
    revalidatePath("/admin/auth");
    revalidatePath("/login");
  }
  return result;
}

export async function updateMemberOrgRoleForm(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const principalId = String(formData.get("principalId") ?? "").trim();
  const orgRole = parseRole(formData, "orgRole");

  if (!principalId) return { error: "Member is missing." };
  if (!orgRole) return { error: "Select a built-in organization role." };

  const result = await updateMemberOrgRoleDecision({ principalId, orgRole });
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin/members");
  return { ok: true, message: "Organization role updated." };
}

export async function updateWorkspaceOverride(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const principalId = String(formData.get("principalId") ?? "").trim();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const roleRaw = String(formData.get("workspaceRole") ?? "")
    .trim()
    .toUpperCase();

  const result = await updateWorkspaceOverrideDecision({ principalId, workspaceId, roleRaw });
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin/members");
  return {
    ok: true,
    message: roleRaw === "INHERIT" ? "Workspace override removed." : "Workspace override saved.",
  };
}

export async function revokeMemberInvite(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const principalId = String(formData.get("principalId") ?? "").trim();

  const result = await revokeMemberInviteDecision({ principalId });
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin/members");
  revalidatePath("/login");
  return { ok: true, message: "Invite revoked." };
}

export async function removeOrganizationMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const principalId = String(formData.get("principalId") ?? "").trim();

  const result = await removeOrganizationMemberDecision({ principalId });
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin/members");
  revalidatePath("/login");
  return { ok: true, message: "Member removed." };
}
