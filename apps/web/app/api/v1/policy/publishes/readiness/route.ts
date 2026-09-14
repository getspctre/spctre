import { authenticateServiceToken } from "@/lib/service-tokens";
import { getPublishReadiness } from "@/lib/domains/review/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

/**
 * Whether a revision can be published yet, and what is still blocking it.
 *
 * A read: `approvals:read` is enough, and it changes nothing. It runs the same
 * readiness check the publish path runs, so a READY answer here is the same
 * answer POST /policy/publishes would act on.
 *
 * Query: ?branchId=...&revisionId=...
 * Returns: { status, blockingReasons, requiredRoles, approvals, verificationRequired }
 */
async function handleGetApiV1PolicyPublishesReadiness(request: Request) {
  const traceId = extractTraceId(request);

  const tokenAuth = await authenticateServiceToken(request, "approvals:read");
  if (!tokenAuth.ok) {
    return withTraceId(
      Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  }

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId")?.trim() ?? "";
  const revisionId = url.searchParams.get("revisionId")?.trim() ?? "";

  if (!branchId || !revisionId) {
    return withTraceId(
      Response.json(
        { error: "branchId and revisionId query params are required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const readiness = await getPublishReadiness(
    { branchId, revisionId },
    { tenantId: tokenAuth.auth.tenantId, workspaceId: tokenAuth.auth.workspaceId },
  );

  if ("error" in readiness) {
    return withTraceId(
      Response.json({ error: readiness.error, meta: makeMeta(traceId) }, { status: 404 }),
      traceId,
    );
  }

  return withTraceId(
    Response.json(
      { ...readiness, meta: makeMeta(traceId) },
      { headers: { "cache-control": "no-store" } },
    ),
    traceId,
  );
}

export { handleGetApiV1PolicyPublishesReadiness as GET };
