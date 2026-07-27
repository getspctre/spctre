import { getAuthSession } from "@/lib/auth-session";
import { listOperationsLedger } from "@/lib/domains/operations/service";
import { getActiveScope } from "@/lib/workspace";
import type { OperationsLogEventType } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiOperations(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  const url = new URL(request.url);
  const eventType = url.searchParams.get("eventType")?.trim() as OperationsLogEventType | undefined || undefined;
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  let entries;
  try {
    entries = await listOperationsLedger({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      eventType,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[operations] listOperationsLog failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  return withTraceId(Response.json({
    entries,
    count: entries.length,
    limit,
    offset,
    generatedAt: new Date().toISOString(),
    pagination: {
      total: entries.length,
      limit,
      offset,
    },
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiOperations as GET };
