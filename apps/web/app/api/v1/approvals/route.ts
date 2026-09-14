import { authenticateServiceToken } from "@/lib/service-tokens";
import { addApprovalDecision, tokenReviewActor } from "@/lib/domains/review/service";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Submit a review decision for a policy revision as the token's own principal.
 *
 * Requires the `approvals:write` scope, which is admin-issuable only and is
 * never granted to runtime agent tokens — a governed agent cannot approve the
 * policy that governs it.
 *
 * The acting reviewer is the principal the token was issued to, read from the
 * token row. There is no `actorId` in the body and there deliberately never
 * will be: a key can only approve in the roles its owner holds, and because an
 * approval is unique per (revision, reviewer), a workflow requiring two roles
 * still requires two keys owned by two reviewers. This is the same
 * authorization the review UI applies, through the same domain call.
 *
 * Body: { revisionId, role, approvalStatus: "APPROVED"|"CHANGES_REQUESTED"|"PENDING", note? }
 * Returns: { ok: true }
 */
async function handlePostApiV1Approvals(request: Request) {
  const traceId = extractTraceId(request);

  const tokenAuth = await authenticateServiceToken(request, "approvals:write");
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
  const revisionId = asString(rec.revisionId);
  const role = asString(rec.role);
  const approvalStatus = asString(rec.approvalStatus);
  const note = asString(rec.note) || null;

  if (!revisionId || !role || !approvalStatus) {
    return withTraceId(
      Response.json(
        { error: "revisionId, role and approvalStatus are required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const result = await addApprovalDecision(
    { revisionId, role, approvalStatus, note },
    { tenantId: tokenAuth.auth.tenantId, workspaceId: tokenAuth.auth.workspaceId },
    tokenReviewActor(tokenAuth.auth.principalId),
  );

  if ("error" in result) {
    // The domain reports a missing revision and a refused reviewer the same
    // way; 422 says the request was understood and the review state refused it.
    const status = result.error === "Revision not found." ? 404 : 422;
    return withTraceId(
      Response.json({ error: result.error, meta: makeMeta(traceId) }, { status }),
      traceId,
    );
  }

  return withTraceId(
    Response.json(
      { ok: true, meta: makeMeta(traceId) },
      { headers: { "cache-control": "no-store" } },
    ),
    traceId,
  );
}

export { handlePostApiV1Approvals as POST };
