import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";

export const dynamic = "force-dynamic";

async function handleGetApiOnboardingStatus(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) {
    return withTraceId(
      Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }),
      traceId
    );
  }

  const scope = await getActiveScope().catch(() => null);
  if (!scope) {
    return withTraceId(
      Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const status = await getWebOnboardingStatus({
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  });

  return withTraceId(Response.json({ status, meta: makeMeta(traceId) }), traceId);
}

export { handleGetApiOnboardingStatus as GET };
