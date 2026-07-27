import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getAuthSession } from "@/lib/auth-session";
import { getActiveActor, requireActorAdminWorkspace } from "@/lib/actors";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { getWorkspaceContext } from "@/lib/workspace";
import { ensureStarterPublishedBundle, getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";

export const dynamic = "force-dynamic";

async function handlePostApiOnboardingStarter(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) {
    return withTraceId(
      Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }),
      traceId
    );
  }

  const workspaceContext = await getWorkspaceContext().catch(() => null);
  if (!workspaceContext) {
    return withTraceId(
      Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const writeCheck = verifyWriteAccess(workspaceContext.tenantId);
  if (!writeCheck.allowed) {
    return withTraceId(
      Response.json({ error: writeCheck.error ?? "Write access denied.", meta: makeMeta(traceId) }, { status: 403 }),
      traceId
    );
  }

  const { actor } = await getActiveActor({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId,
  });
  const adminCheck = requireActorAdminWorkspace(actor, workspaceContext.workspaceSlug);
  if (!adminCheck.allowed) {
    return withTraceId(
      Response.json({ error: adminCheck.reason, meta: makeMeta(traceId) }, { status: 403 }),
      traceId
    );
  }

  const bundle = await ensureStarterPublishedBundle({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    actorId: actor.id,
    environment: "development",
  });
  const status = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });

  return withTraceId(Response.json({ bundle, status, meta: makeMeta(traceId) }), traceId);
}

export { handlePostApiOnboardingStarter as POST };
