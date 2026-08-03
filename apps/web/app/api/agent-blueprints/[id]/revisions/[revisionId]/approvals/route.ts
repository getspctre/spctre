import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { getAgentBlueprintApprovals, getAgentBlueprintWorkspaceScope, submitBlueprintApproval } from "@/lib/domains/agent-blueprints/service";
import { ALL_REVIEWER_ROLES } from "@/lib/approval-config";
import { findActorById, canActorReviewRole } from "@/lib/actors";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const traceId = extractTraceId(request); const scope = await getActiveScope().catch(swallow("getActiveScope", null)); const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!scope || !session) return withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  const { revisionId } = await params;
  const approvals = await getAgentBlueprintApprovals({ tenantId: scope.tenantId, revisionId });
  return withTraceId(Response.json({ approvals, meta: makeMeta(traceId) }), traceId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const traceId = extractTraceId(request); const scope = await getActiveScope().catch(swallow("getActiveScope", null)); const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!scope || !session) return withTraceId(Response.json({ error: "Authentication and workspace context are required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const role = typeof body?.role === "string" ? body.role : ""; const status = body?.status;
  if (!(ALL_REVIEWER_ROLES as readonly string[]).includes(role) || !["APPROVED", "CHANGES_REQUESTED", "PENDING"].includes(String(status))) return withTraceId(Response.json({ error: "A valid reviewer role and status are required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  const actor = await findActorById(session.principalId, { tenantId: scope.tenantId, workspaceId: scope.workspaceId });
  if (!actor) return withTraceId(Response.json({ error: "Reviewer principal is not available.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  const { id: blueprintId, revisionId } = await params;
  // Authorize the reviewer against the Blueprint's real governing workspace, not
  // a hardcoded slug; "workspace-demo" is only the no-workspace/no-DB null-guard.
  const workspaceScope = await getAgentBlueprintWorkspaceScope({ tenantId: scope.tenantId, blueprintId });
  const review = canActorReviewRole(actor, workspaceScope?.workspace_slug ?? "workspace-demo", role);
  if (!review.allowed) return withTraceId(Response.json({ error: review.reason ?? "Review is not allowed.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  const ok = await submitBlueprintApproval({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, blueprintId, revisionId, reviewerId: actor.id, reviewerRole: role, status: status as "APPROVED" | "CHANGES_REQUESTED" | "PENDING", note: typeof body?.note === "string" ? body.note : null });
  if (!ok) return withTraceId(Response.json({ error: "Blueprint revision not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  appendOperationsLog({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, eventType: "BLUEPRINT_APPROVE", sourceId: revisionId, sourceTable: "agent_blueprint_approval", actorId: actor.id, payload: { blueprintId, role, status } }).catch(swallow("appendOperationsLog", undefined));
  return withTraceId(Response.json({ ok: true, meta: makeMeta(traceId) }), traceId);
}
