import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { getActiveScope } from "@/lib/workspace";
import { makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export interface McpRegistryScope {
  tenantId: string;
  workspaceId: string;
  principalId: string;
}

/**
 * Registry reads and writes are operator-console work, so they take a session
 * rather than a service token, and the write path additionally takes Admin.
 *
 * The order matches app/api/service-keys: authenticate, resolve the workspace,
 * check Admin, then the demo-tenant write guard — so a non-admin learns the
 * more specific truth about their own request before the tenant-wide one.
 */
export async function resolveMcpRegistryScope(
  traceId: string,
  options: { write: boolean },
): Promise<McpRegistryScope | Response> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(
      Response.json(
        { error: "Authentication required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  }

  const scope = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!scope) {
    return withTraceId(
      Response.json(
        { error: "Workspace context unavailable.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  if (options.write) {
    const actor = await findActorById(session.principalId, {
      tenantId: session.tenantId,
      workspaceId: scope.workspaceId,
    }).catch(swallow("findActorById", null));
    if (!actor?.reviewerRoles.includes("Admin")) {
      return withTraceId(
        Response.json(
          { error: "Admin permission is required.", meta: makeMeta(traceId) },
          { status: 403 },
        ),
        traceId,
      );
    }

    const write = verifyWriteAccess(session.tenantId);
    if (!write.allowed) {
      return withTraceId(
        Response.json(
          { error: write.error ?? "Write access denied.", meta: makeMeta(traceId) },
          { status: 403 },
        ),
        traceId,
      );
    }
  }

  return {
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
    principalId: session.principalId,
  };
}
