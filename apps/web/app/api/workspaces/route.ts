import { listWorkspaceApiSummaries } from "@/lib/domains/workspace/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiWorkspaces(request: Request) {
  const traceId = extractTraceId(request);

  const scope = await resolveRouteScope(request, { serviceTokenScope: "workspaces:read", traceId });
  if (scope instanceof Response) return scope;
  const { tenantId } = scope;

  let results;
  try {
    results = await listWorkspaceApiSummaries(tenantId);
  } catch (err) {
    console.error("[workspaces] listWorkspaceApiSummaries failed", err);
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
      workspaces: results,
      count: results.length,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiWorkspaces as GET };
