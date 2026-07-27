import { getAuthSession } from "@/lib/auth-session";
import { verifyOperationsLedger } from "@/lib/domains/operations/service";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiOperationsVerify(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  const url = new URL(request.url);
  const limit = Math.max(10, Math.min(10000, Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500));

  const verification = await verifyOperationsLedger({ tenantId: ctx.tenantId, limit });

  return withTraceId(Response.json({ ...verification, meta: makeMeta(traceId) }, { status: verification.verified ? 200 : 409 }), traceId);
}

export { handleGetApiOperationsVerify as GET };
