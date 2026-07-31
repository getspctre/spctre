import { listTokenRevocations } from "@/lib/domains/auth/service";

import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiTokenRevocations(request: Request) {
  const traceId = extractTraceId(request);

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(
      Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }),
      traceId
    );
  }

  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) {
    return withTraceId(
      Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));

  const revocations = await listTokenRevocations({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, limit });

  return withTraceId(
    Response.json({
      revocations,
      count: revocations.length,
      generatedAt: new Date().toISOString(),
      pagination: { total: revocations.length, limit, offset: 0 },
      meta: makeMeta(traceId),
    }),
    traceId
  );
}

export { handleGetApiTokenRevocations as GET };
