import { getLatestPublishedPolicyBundle } from "@/lib/domains/policy/service";

import { getActiveScope } from "@/lib/workspace";
import { getAuthSession } from "@/lib/auth-session";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { evaluateDecision } from "@spctre/policy-schema";
import {
  EvaluateSchema,
  extractTraceId,
  makeMeta,
  parseBody,
  withTraceId,
} from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handlePostApiEvaluate(request: Request) {
  const traceId = extractTraceId(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withTraceId(Response.json({ error: "Request body must be JSON.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Payload must be an object.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const parsed = parseBody(EvaluateSchema, body);
  if (!parsed.ok) {
    return withTraceId(
      Response.json({ error: parsed.error, issues: parsed.issues, meta: makeMeta(traceId) }, { status: 400 }),
      traceId
    );
  }

  const { connector, action, domains = [], toolIntent, planSummary, toolParameters } = parsed.value;

  const auth = await resolveEvaluateAuth(request);
  if (!auth.ok) {
    return withTraceId(Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: auth.status }), traceId);
  }

  let published;
  try {
    published = await getLatestPublishedPolicyBundle({ workspaceId: auth.workspaceId, tenantId: auth.tenantId });
  } catch (err) {
    console.error("[evaluate] getLatestPublishedPolicyBundle failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!published) {
    return withTraceId(Response.json(
      { error: "No published policy bundle available for this workspace.", meta: makeMeta(traceId) },
      { status: 404 }
    ), traceId);
  }

  const result = evaluateDecision({
    connector,
    action,
    domains,
    rules: published.bundle.rules,
    toolIntent,
    planSummary,
    toolParameters,
  });

  return withTraceId(Response.json({
    connector,
    action,
    domains,
    toolIntent,
    planSummary,
    toolParameters,
    branchId: published.branchId,
    revisionId: published.revisionId,
    artifactHash: published.artifactHash,
    publishedAt: published.publishedAt,
    result,
    meta: makeMeta(traceId),
  }), traceId);
}

async function resolveEvaluateAuth(request: Request): Promise<
  | { ok: true; tenantId: string; workspaceId: string }
  | { ok: false; error: string; status: number }
> {
  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "decision:evaluate");
    if (!tokenAuth.ok) {
      return { ok: false, error: "Invalid or expired service token.", status: 401 };
    }
    const { tenantId, workspaceId } = tokenAuth.auth;
    if (!tenantId || !workspaceId) {
      return { ok: false, error: "Workspace context unavailable.", status: 400 };
    }
    return { ok: true, tenantId, workspaceId };
  }

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return { ok: false, error: "Authentication required.", status: 401 };
  }

  try {
    const ctx = await getActiveScope();
    return { ok: true, workspaceId: ctx.workspaceId, tenantId: ctx.tenantId };
  } catch {
    return { ok: false, error: "Unable to resolve workspace context.", status: 403 };
  }
}

export { handlePostApiEvaluate as POST };
