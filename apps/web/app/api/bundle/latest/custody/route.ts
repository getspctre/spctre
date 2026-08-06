import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getLatestPublishedPolicyBundle } from "@/lib/domains/policy/service";
import { retainPublishedPolicyContentArtifact } from "@/lib/repositories/policy-content-artifacts";
import { resolveRouteScope } from "../../../_route-scope";

export const dynamic = "force-dynamic";

/** Retain the exact raw bundle bytes under the immutable publication event. */
async function handlePostBundleLatestCustody(request: Request) {
  const traceId = extractTraceId(request);
  const scope = await resolveRouteScope(request, { serviceTokenScope: "bundle:read", traceId });
  if (scope instanceof Response) return scope;
  const published = await getLatestPublishedPolicyBundle({
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
  });
  if (!published) {
    return withTraceId(Response.json({ error: "No published policy bundle is available for this workspace.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(published.bundle, null, 2));
  try {
    await retainPublishedPolicyContentArtifact({
      contentHash: published.contentHash,
      bytes,
      mediaType: "application/json",
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      publishId: published.publishId,
      revisionId: published.revisionId,
    });
  } catch (error) {
    return withTraceId(Response.json({ error: error instanceof Error ? error.message : "Published bundle custody failed.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
  return withTraceId(Response.json({ contentHash: published.contentHash, publishId: published.publishId, retained: true, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handlePostBundleLatestCustody as POST };
