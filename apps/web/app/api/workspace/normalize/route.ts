import { cookies } from "next/headers";
import { getAuthSession } from "@/lib/auth-session";
import { DEMO_WORKSPACE_ID } from "@/lib/demo";
import {
  isWorkspaceDatabaseConfigured,
  normalizeWorkspaceSelection,
} from "@/lib/domains/workspace/service";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/cookies";
import { extractTraceId, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

interface WorkspacePayload {
  tenantId?: unknown;
  workspaceId?: unknown;
}

async function handlePostApiWorkspaceNormalize(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(new Response(null, { status: 401 }), traceId);
  }

  let requestedTenantId = "";
  let requestedWorkspaceId = "";

  try {
    const payload = (await request.json()) as WorkspacePayload;
    requestedTenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
    requestedWorkspaceId =
      typeof payload.workspaceId === "string" ? payload.workspaceId.trim() : "";
  } catch {
    // Default to the first available workspace when no valid JSON body is provided.
  }

  let tenantId = session.tenantId;
  let workspaceId = DEMO_WORKSPACE_ID;

  if (isWorkspaceDatabaseConfigured()) {
    const resolved = await normalizeWorkspaceSelection({
      sessionTenantId: tenantId,
      principalSubject: session.subject,
      requestedTenantId,
      requestedWorkspaceId,
    });
    tenantId = resolved.tenantId;
    workspaceId = resolved.workspaceId;
  } else if (requestedWorkspaceId) {
    workspaceId = requestedWorkspaceId;
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production"
  });
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production"
  });

  return withTraceId(new Response(null, { status: 204 }), traceId);
}

export { handlePostApiWorkspaceNormalize as POST };
