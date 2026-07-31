import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { listServiceKeys, recordAuthOperation } from "@/lib/domains/auth/service";

import {
  ADMIN_ISSUABLE_API_KEY_SCOPES,
  issueServiceAccountKey,
  type ServiceTokenScope,
} from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiServiceKeys(request: Request) {
  const traceId = extractTraceId(request);

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  let keys;
  try {
    keys = await listServiceKeys({ tenantId: session.tenantId, workspaceId: ctx.workspaceId });
  } catch (err) {
    console.error("[service-keys] listActiveApiKeys failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
  if (keys === null) {
    return withTraceId(Response.json({ error: "Database not configured.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  return withTraceId(
    Response.json({
      keys,
      meta: makeMeta(traceId),
    }),
    traceId
  );
}

async function handlePostApiServiceKeys(request: Request) {
  const traceId = extractTraceId(request);

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) {
    return withTraceId(Response.json({ error: "Admin permission is required.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  }

  let body: { label?: unknown; scopes?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return withTraceId(Response.json({ error: "Invalid JSON body.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 64) : "";
  if (!label) {
    return withTraceId(Response.json({ error: "label is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const rawScopes = Array.isArray(body.scopes) ? body.scopes : ["bundle:read", "decision:evaluate", "evidence:write", "heartbeat:write"];
  const scopes = rawScopes.filter((s): s is ServiceTokenScope =>
    typeof s === "string" && ADMIN_ISSUABLE_API_KEY_SCOPES.includes(s as ServiceTokenScope)
  );
  if (!scopes.length) {
    return withTraceId(Response.json({ error: "At least one valid scope is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const expiresInDays = typeof body.expiresInDays === "number" && body.expiresInDays >= 1 && body.expiresInDays <= 365
    ? body.expiresInDays
    : undefined;

  let result;
  try {
    result = await issueServiceAccountKey({
      tenantId: session.tenantId,
      workspaceId: ctx.workspaceId,
      principalId: session.principalId,
      createdBy: session.principalId,
      label,
      scopes,
      expiresInDays,
    });
  } catch (err) {
    console.error("[service-keys] issueServiceAccountKey failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  recordAuthOperation({
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
    eventType: "TOKEN_ISSUED",
    sourceId: result.tokenId,
    sourceTable: "service_token",
    actorId: session.principalId,
    payload: { label, scopes, keyType: "API_KEY", expiresInDays: expiresInDays ?? null },
  }).catch(swallow("recordAuthOperation", undefined));

  return withTraceId(
    Response.json(
      {
        id: result.tokenId,
        rawToken: result.rawToken,
        label,
        scopes: result.scopes,
        expiresAt: result.expiresAt,
        tokenPrefix: result.tokenPrefix,
        meta: makeMeta(traceId),
      },
      { status: 201, headers: { "cache-control": "no-store" } }
    ),
    traceId
  );
}

export { handleGetApiServiceKeys as GET };
export { handlePostApiServiceKeys as POST };
