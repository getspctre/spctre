import { listIdentityEvents } from "@/lib/domains/identity/service";

import type { IdentityLifecycleEventType } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiIdentityEvents(request: Request) {
  const traceId = extractTraceId(request);
  // The MCP server reads identity history for the agents it governs, so this
  // accepts a service token as well as a session.
  const scope = await resolveRouteScope(request, { serviceTokenScope: "operations:read", traceId });
  if (scope instanceof Response) return scope;
  const ctx = scope;

  const url = new URL(request.url);
  const principalId = url.searchParams.get("principalId")?.trim() || undefined;
  const eventTypeParam = url.searchParams.get("eventType")?.trim() || undefined;
  const limit = Math.max(
    1,
    Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );

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
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json({
      events,
      count: events.length,
      generatedAt: new Date().toISOString(),
      pagination: { total: events.length, limit, offset: 0 },
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiIdentityEvents as GET };
