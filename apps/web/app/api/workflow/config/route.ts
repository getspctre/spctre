import { getApprovalWorkflowConfig } from "@/lib/domains/workflows/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiWorkflowConfig(request: Request) {
  const traceId = extractTraceId(request);
  const scope = await resolveRouteScope(request, { serviceTokenScope: "workflow:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  const url = new URL(request.url);
  const environment = url.searchParams.get("environment") ?? null;

  let workflow;
  try {
    workflow = await getApprovalWorkflowConfig({ tenantId, workspaceId, environment });
  } catch (err) {
    console.error("[workflow/config] getApprovalWorkflowForContext failed", err);
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
      workflow,
      workspaceId,
      environment: environment ?? null,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiWorkflowConfig as GET };
