import { authenticateServiceToken } from "@/lib/service-tokens";
import { publishRevisionDecision, tokenReviewActor } from "@/lib/domains/review/service";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Publish an approved policy revision as the token's own principal.
 *
 * Requires the `publish:write` scope, which is admin-issuable only and is never
 * granted to runtime agent tokens. The acting principal comes from the token
 * row, so publishing through this route needs a key owned by someone whose
 * grants already allow publishing that branch's scope.
 *
 * Every gate the review UI applies applies here, because this calls the same
 * domain function: required approvals, verification policy, rule validation,
 * the kernel request budget, managed-replay regressions, and unresolved gateway
 * escalations. A revision that is not ready is refused with the reason, not
 * published.
 *
 * Body: { branchId, revisionId }
 * Returns: { artifactHash }
 */
async function handlePostApiV1PolicyPublishes(request: Request) {
  const traceId = extractTraceId(request);

  const tokenAuth = await authenticateServiceToken(request, "publish:write");
  if (!tokenAuth.ok) {
    return withTraceId(
      Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  }

  const writeCheck = verifyWriteAccess(tokenAuth.auth.tenantId);
  if (!writeCheck.allowed) {
    return withTraceId(
      Response.json(
        { error: writeCheck.error ?? "Write access denied.", meta: makeMeta(traceId) },
        { status: 403 },
      ),
      traceId,
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(
      Response.json(
        { error: "Request body must be an object.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const rec = body as Record<string, unknown>;
  const branchId = asString(rec.branchId);
  const revisionId = asString(rec.revisionId);

  if (!branchId || !revisionId) {
    return withTraceId(
      Response.json(
        { error: "branchId and revisionId are required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const result = await publishRevisionDecision(
    { branchId, revisionId },
    { tenantId: tokenAuth.auth.tenantId, workspaceId: tokenAuth.auth.workspaceId },
    tokenReviewActor(tokenAuth.auth.principalId),
  );

  if ("error" in result) {
    // 404 for a branch or revision that is not there; 422 for one that is but
    // is not publishable yet, so a caller can tell "wrong id" from "not ready".
    const notFound =
      result.error === "Branch not found." || result.error === "Revision not found on this branch.";
    return withTraceId(
      Response.json(
        { error: result.error, meta: makeMeta(traceId) },
        { status: notFound ? 404 : 422 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json(
      { artifactHash: result.artifactHash, meta: makeMeta(traceId) },
      { status: 201, headers: { "cache-control": "no-store" } },
    ),
    traceId,
  );
}

export { handlePostApiV1PolicyPublishes as POST };
