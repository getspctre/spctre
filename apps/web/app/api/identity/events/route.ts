import { listIdentityEvents } from "@/lib/domains/identity/service";

import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import type { IdentityLifecycleEventType } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handleGetApiIdentityEvents(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  const url = new URL(request.url);
  const principalId = url.searchParams.get("principalId")?.trim() || undefined;
  const eventTypeParam = url.searchParams.get("eventType")?.trim() || undefined;
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));

  let events;
  try {
    events = await listIdentityEvents({
      tenantId: ctx.tenantId,
      principalId,
      eventType: eventTypeParam as IdentityLifecycleEventType | undefined,
      limit,
    });
  } catch (err) {
    console.error("[identity/events] listIdentityLifecycleEvents failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  return withTraceId(Response.json({
    events,
    count: events.length,
    generatedAt: new Date().toISOString(),
    pagination: {
      total: events.length,
      limit,
      offset: 0,
    },
    meta: makeMeta(traceId),
  }), traceId);
}

export { handleGetApiIdentityEvents as GET };
