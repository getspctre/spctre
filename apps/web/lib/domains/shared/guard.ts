import { getAuthSession } from "@/lib/auth-session";
import { getRequiredWorkspaceContext } from "@/lib/workspace";
import { findActorById } from "@/lib/actors";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { isDatabaseConfigured } from "@/lib/workspace/repository";
import { swallow } from "@/lib/platform/swallow";

export type GuardError = { error: string };

export async function requireAdminActor(
  workspaceId?: string,
): Promise<
  | GuardError
  | { session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>; workspaceId: string }
> {
  if (!isDatabaseConfigured()) {
    return { error: "Database is not configured." };
  }

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return { error: "Authentication required." };
  }

  const ctx = await getRequiredWorkspaceContext();
  const activeWorkspaceId = workspaceId ?? ctx.workspaceId;

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: activeWorkspaceId,
  }).catch(swallow("findActorById", null));

  if (!actor || !actor.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission is required." };
  }

  return { session, workspaceId: activeWorkspaceId };
}

export function checkWriteAccess(tenantId: string): GuardError | { allowed: true } {
  const check = verifyWriteAccess(tenantId);
  if (!check.allowed) {
    return { error: check.error ?? "Write access denied." };
  }
  return { allowed: true };
}
