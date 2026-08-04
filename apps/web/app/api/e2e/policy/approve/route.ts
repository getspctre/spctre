import { authenticateServiceToken } from "@/lib/service-tokens";
import { getBooleanEnv } from "@/lib/platform/config";
import { upsertApprovalForRevision, getRevisionWorkspaceScope } from "@/lib/repositories/policy";
import { findActorById, canActorReviewRole } from "@/lib/actors";
import { runWithTenantContext } from "@/lib/tenant-context";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["APPROVED", "CHANGES_REQUESTED"]);

/**
 * E2E support route: submit an approval or changes-request for a revision as a
 * specific actor. Preserves the reviewer-role check (canActorReviewRole) so the
 * test validates real authz semantics rather than bypassing them.
 *
 * Body: { revisionId, role, actorId, approvalStatus: "APPROVED"|"CHANGES_REQUESTED", note? }
 * Returns: { ok: true } | { error: string }
 */
interface ApproveRequestFields {
  revisionId: string;
  role: string;
  actorId: string;
  approvalStatus: string;
  note: string | null;
}

// Coerce and validate the approval request body.
function parseApproveRequest(body: unknown): ApproveRequestFields | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be an object." };
  }

  const rec = body as Record<string, unknown>;
  const revisionId = typeof rec.revisionId === "string" ? rec.revisionId.trim() : "";
  const role = typeof rec.role === "string" ? rec.role.trim() : "";
  const actorId = typeof rec.actorId === "string" ? rec.actorId.trim() : "";
  const approvalStatus = typeof rec.approvalStatus === "string" ? rec.approvalStatus.trim() : "";
  const note = typeof rec.note === "string" ? rec.note.trim() : null;

  if (!revisionId) return { error: "revisionId is required." };
  if (!role) return { error: "role is required." };
  if (!actorId) return { error: "actorId is required." };
  if (!VALID_STATUSES.has(approvalStatus)) {
    return { error: "approvalStatus must be APPROVED or CHANGES_REQUESTED." };
  }

  return { revisionId, role, actorId, approvalStatus, note };
}

async function handlePostApiE2ePolicyApprove(request: Request) {
  const traceId = extractTraceId(request);
  if (!getBooleanEnv("SPCTRE_E2E_API_ENABLED", false)) {
    return withTraceId(Response.json({ error: "E2E support API is disabled.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  const tokenAuth = await authenticateServiceToken(request, "e2e:write");
  if (!tokenAuth.ok) {
    return withTraceId(Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  const body = await request.json().catch(() => null);
  const parsed = parseApproveRequest(body);
  if ("error" in parsed) {
    return withTraceId(Response.json({ error: parsed.error, meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  const { revisionId, role, actorId, approvalStatus, note } = parsed;

  const revisionRow = await runWithTenantContext(tokenAuth.auth.tenantId, () =>
    getRevisionWorkspaceScope({
      tenantId: tokenAuth.auth.tenantId,
      revisionId,
    }).catch(swallow("getRevisionWorkspaceScope", null))
  );
  if (!revisionRow) {
    return withTraceId(Response.json({ error: "Revision not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  const actor = await runWithTenantContext(tokenAuth.auth.tenantId, () =>
    findActorById(actorId, {
      workspaceId: revisionRow.workspace_id ?? tokenAuth.auth.workspaceId,
      tenantId: tokenAuth.auth.tenantId,
    })
  );
  if (!actor) {
    return withTraceId(Response.json({ error: "Actor not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  const workspaceSlug = revisionRow.workspace_slug ?? "workspace-demo";
  const reviewCheck = canActorReviewRole(actor, workspaceSlug, role);
  if (!reviewCheck.allowed) {
    return withTraceId(Response.json({ error: reviewCheck.reason ?? "Actor does not have the required reviewer role.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  }

  await runWithTenantContext(tokenAuth.auth.tenantId, () =>
    upsertApprovalForRevision({
      tenantId: tokenAuth.auth.tenantId,
      revisionId,
      actorId: actor.id,
      role,
      approvalStatus: approvalStatus as "APPROVED" | "CHANGES_REQUESTED",
      note,
    })
  );

  return withTraceId(Response.json({ ok: true, meta: makeMeta(traceId) }), traceId);
}

export { handlePostApiE2ePolicyApprove as POST };
