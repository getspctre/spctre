import { cookies } from "next/headers";
import { getAuthSession } from "../auth-session";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "../demo";
import { isDatabaseConfigured } from "./repository";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "./cookies";
import { listWorkspacesForWorkspaceContext } from "@/lib/repositories/workspace/context";
import { swallow } from "@/lib/platform/swallow";

export interface ActiveScope {
  tenantId: string;
  workspaceId: string;
}

/**
 * Resolves the active tenant and workspace IDs for API routes.
 *
 * The workspace is verified against the principal's permission grants — a
 * cookie-supplied workspace ID that the principal has no grant for is rejected
 * and the first available workspace is used instead. This prevents intra-tenant
 * BOLA: an authenticated user cannot read or write data in a workspace they
 * are not a member of simply by changing the active-workspace cookie.
 */
export async function getActiveScope(): Promise<ActiveScope> {
  if (!isDatabaseConfigured()) {
    return { tenantId: DEMO_TENANT_ID, workspaceId: DEMO_WORKSPACE_ID };
  }

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return { tenantId: DEMO_TENANT_ID, workspaceId: DEMO_WORKSPACE_ID };
  }

  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;

  // Fetch only the workspaces this principal is granted access to.
  const available = await listWorkspacesForWorkspaceContext(session.tenantId, session.principalId);

  // Accept the cookie workspace only if it appears in the principal's grant set.
  const granted =
    cookieWorkspaceId && available.some((w) => w.id === cookieWorkspaceId)
      ? cookieWorkspaceId
      : (available[0]?.id ?? DEMO_WORKSPACE_ID);

  return { tenantId: session.tenantId, workspaceId: granted };
}
