import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { listOrganizationMembersForApi } from "@/lib/domains/members/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiMembers(request: Request) {
  const traceId = extractTraceId(request);
  let tenantId: string;

  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "members:read");
    if (!tokenAuth.ok) {
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    tenantId = tokenAuth.auth.tenantId;
  } else {
    const session = await getAuthSession().catch(() => null);
    if (!session) {
      return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    const ctx = await getActiveScope().catch(() => null);
    if (!ctx) {
      return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
    }
    tenantId = ctx.tenantId;
  }

  if (!tenantId) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

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
