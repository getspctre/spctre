"use server";

import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { isWorkspaceDatabaseConfigured } from "@/lib/domains/workspace/service";
import { getRequiredWorkspaceContext } from "@/lib/workspace";

export type AdminAuthActionState =
  | { ok: true; message?: string; messageCode?: string; error?: never; errorCode?: never }
  | { ok?: never; message?: never; messageCode?: never; error: string; errorCode?: string }
  | null;

export async function requireAdminSession() {
  if (!isWorkspaceDatabaseConfigured()) {
    return { error: "Database is not configured." } as const;
  }

  const session = await getAuthSession().catch(() => null);
  if (!session) {
    return { error: "Authentication required." } as const;
  }

  const { workspaceId } = await getRequiredWorkspaceContext();

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId
  }).catch(() => null);
  if (!actor || !actor.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission is required." } as const;
  }

  return { session } as const;
}
