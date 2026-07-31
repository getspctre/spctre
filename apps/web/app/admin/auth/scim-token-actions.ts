"use server";

import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { getActiveScope } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";
import {
  createScimToken,
  isScimProvisioningEntitled,
  revokeScimToken,
} from "@/lib/domains/scim-token/service";
import { swallow } from "@/lib/platform/swallow";

export type ScimTokenActionState =
  | { ok: true; token: string; label: string | null; error?: never; errorCode?: never }
  | { ok?: never; token?: never; label?: never; error: string; errorCode?: string }
  | null;

export type ScimTokenMutationState =
  | { ok: true; error?: never; errorCode?: never }
  | { ok?: never; error: string; errorCode?: string }
  | null;

async function requireScimAdmin() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required.", errorCode: "auth_required" } as const;
  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) return { error: "Workspace context unavailable.", errorCode: "workspace_unavailable" } as const;
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission is required.", errorCode: "admin_required" } as const;
  }
  const entitled = await isScimProvisioningEntitled(session.tenantId).catch(swallow("isScimProvisioningEntitled", false));
  if (!entitled) {
    return { error: "SCIM provisioning requires an Enterprise subscription.", errorCode: "not_entitled" } as const;
  }
  return { session } as const;
}

export async function createScimProvisioningToken(
  _prev: ScimTokenActionState,
  formData: FormData
): Promise<ScimTokenActionState> {
  const guard = await requireScimAdmin();
  if ("error" in guard) {
    return {
      error: guard.error ?? "Permission denied.",
      errorCode: guard.errorCode ?? "permission_denied",
    };
  }

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) {
    return { error: writeCheck.error ?? "Write access denied.", errorCode: "write_denied" };
  }

  const label = String(formData.get("label") ?? "").trim() || undefined;

  try {
    const result = await createScimToken({
      tenantId: guard.session.tenantId,
      label,
      createdBy: guard.session.principalId,
    });
    revalidatePath("/admin/auth");
    return { ok: true, token: result.token, label: result.registration.label };
  } catch {
    return { error: "Failed to create SCIM token.", errorCode: "create_failed" };
  }
}

export async function revokeScimProvisioningToken(
  _prev: ScimTokenMutationState,
  formData: FormData
): Promise<ScimTokenMutationState> {
  const guard = await requireScimAdmin();
  if ("error" in guard) {
    return {
      error: guard.error ?? "Permission denied.",
      errorCode: guard.errorCode ?? "permission_denied",
    };
  }

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) {
    return { error: writeCheck.error ?? "Write access denied.", errorCode: "write_denied" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return { error: "Token ID is required.", errorCode: "revoke_failed" };
  }

  const revoked = await revokeScimToken({
    id,
    tenantId: guard.session.tenantId,
    actorId: guard.session.principalId,
  }).catch(swallow("revokeScimToken", false));

  if (!revoked) {
    return { error: "Token was not found or is already revoked.", errorCode: "revoke_failed" };
  }

  revalidatePath("/admin/auth");
  return { ok: true };
}
