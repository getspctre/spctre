import { getActiveScope } from "@/lib/workspace";
import {
  listAdapterDeclarationsForWorkspace,
  upsertAdapterDeclarationForWorkspace,
} from "@/lib/domains/packs/service";

import { getAuthSession } from "@/lib/auth-session";
import {
  AdapterDeclarationSchema,
  extractTraceId,
  makeMeta,
  parseBody,
  withTraceId,
} from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiAdapters(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(
      Response.json(
        { error: "Authentication required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  }

  const url = new URL(request.url);
  const environment = url.searchParams.get("environment") ?? undefined;

  let workspaceId = "";
  let tenantId = session.tenantId;
  try {
    const ctx = await getActiveScope();
    workspaceId = ctx.workspaceId;
    tenantId = ctx.tenantId;
  } catch {
    return withTraceId(
      Response.json(
        { error: "Unable to resolve workspace context.", meta: makeMeta(traceId) },
        { status: 403 },
      ),
      traceId,
    );
  }

  try {
    const adapters = await listAdapterDeclarationsForWorkspace({
      workspaceId,
      tenantId,
      environment,
    });
    return withTraceId(Response.json({ adapters, meta: makeMeta(traceId) }), traceId);
  } catch (err) {
    console.error("[adapters] listAdapterDeclarationsForWorkspace failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 500 },
      ),
      traceId,
    );
  }
}

async function handlePostApiAdapters(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(
      Response.json(
        { error: "Authentication required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withTraceId(
      Response.json(
        { error: "Request body must be JSON.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const declaration = parseBody(AdapterDeclarationSchema, body);
  if (!declaration.ok) {
    return withTraceId(
      Response.json(
        { error: declaration.error, issues: declaration.issues, meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  let workspaceId = "";
  let tenantId = session.tenantId;
  try {
    const ctx = await getActiveScope();
    workspaceId = ctx.workspaceId;
    tenantId = ctx.tenantId;
  } catch {
    return withTraceId(
      Response.json(
        { error: "Unable to resolve workspace context.", meta: makeMeta(traceId) },
        { status: 403 },
      ),
      traceId,
    );
  }

  try {
    const id = await upsertAdapterDeclarationForWorkspace(declaration.value, {
      workspaceId,
      tenantId,
    });
    return withTraceId(Response.json({ id, meta: makeMeta(traceId) }, { status: 201 }), traceId);
  } catch (err) {
    console.error("[adapters] upsertAdapterDeclarationForWorkspace failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 500 },
      ),
      traceId,
    );
  }
}

export { handleGetApiAdapters as GET };
export { handlePostApiAdapters as POST };
