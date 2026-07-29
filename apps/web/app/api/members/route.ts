import { listOrganizationMembersForApi } from "@/lib/domains/members/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiMembers(request: Request) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "members:read", traceId });
  if (scope instanceof Response) return scope;
  const { tenantId } = scope;

  let members;
  try {
    members = await listOrganizationMembersForApi(tenantId);
  } catch (err) {
    console.error("[members] listOrganizationMembers failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  const summary = members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    email: m.email,
    orgRole: m.orgRole,
    inviteStatus: m.inviteStatus,
    grants: m.grants.map((g) => ({
      workspaceId: g.workspaceId,
      workspaceSlug: g.workspaceSlug,
      workspaceName: g.workspaceName,
      role: g.role,
    })),
  }));

  return withTraceId(Response.json({
    members: summary,
    count: summary.length,
    generatedAt: new Date().toISOString(),
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiMembers as GET };
