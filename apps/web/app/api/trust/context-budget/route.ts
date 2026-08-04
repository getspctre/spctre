import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import {
  ingestContextBudget,
  listContextBudget,
  recordTrustOperation,
} from "@/lib/domains/trust/service";
import { isRecord } from "@/lib/records";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import type { ContextBudgetEventType } from "@spctre/policy-schema";
import {
  asInt,
  asNumber,
  asString,
  delegateTrustPostToWorker,
  resolveAuth,
  VALID_STACKS,
} from "../_shared";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const VALID_EVENT_TYPES = new Set<ContextBudgetEventType>([
  "TOKEN_GROWTH",
  "SUMMARIZATION_EVENT",
  "CONTEXT_SOURCE_MIX",
  "BUDGET_BREACH",
]);

async function handleGetApiTrustContextBudget(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session)
    return withTraceId(
      Response.json(
        { error: "Authentication required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );

  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx)
    return withTraceId(
      Response.json(
        { error: "Workspace context unavailable.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
  const agentId = url.searchParams.get("agentId")?.trim() || undefined;
  const eventType = url.searchParams.get("eventType")?.trim() as ContextBudgetEventType | undefined;
  const limit = Math.max(
    1,
    Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );

  if (eventType && !VALID_EVENT_TYPES.has(eventType)) {
    return withTraceId(
      Response.json({ error: "Invalid eventType.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  let events;
  try {
    events = await listContextBudget({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      sessionId,
      agentId,
      eventType,
      limit,
    });
  } catch (err) {
    console.error("[trust/context-budget] listContextBudgetEvents failed", err);
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
      events,
      count: events.length,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

interface ContextBudgetFields {
  sessionId: string;
  agentId: string;
  environment: string;
  runtimeStack: string;
  eventType: ContextBudgetEventType;
  tokenCount: number;
}

// Coerce and validate the required context-budget event fields.
function parseContextBudgetFields(
  rec: Record<string, unknown>,
): ContextBudgetFields | { error: string } {
  const sessionId = asString(rec.sessionId);
  const agentId = asString(rec.agentId);
  const environment = asString(rec.environment);
  const runtimeStack = asString(rec.runtimeStack);
  const eventType = asString(rec.eventType) as ContextBudgetEventType | undefined;
  const tokenCount = asInt(rec.tokenCount);

  if (!sessionId) return { error: "sessionId is required." };
  if (!agentId) return { error: "agentId is required." };
  if (!environment) return { error: "environment is required." };
  if (!runtimeStack || !VALID_STACKS.has(runtimeStack)) {
    return { error: "runtimeStack must be a supported runtime stack." };
  }
  if (!eventType || !VALID_EVENT_TYPES.has(eventType)) {
    return {
      error:
        "eventType must be one of: TOKEN_GROWTH, SUMMARIZATION_EVENT, CONTEXT_SOURCE_MIX, BUDGET_BREACH.",
    };
  }
  if (tokenCount === undefined || tokenCount < 0) {
    return { error: "tokenCount must be a non-negative integer." };
  }

  return { sessionId, agentId, environment, runtimeStack, eventType, tokenCount };
}

async function handlePostApiTrustContextBudget(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await resolveAuth(request);
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );

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
  const fields = parseContextBudgetFields(rec);
  if ("error" in fields) {
    return withTraceId(
      Response.json({ error: fields.error, meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }
  const { sessionId, agentId, environment, runtimeStack, eventType, tokenCount } = fields;

  const budgetLimit = asInt(rec.budgetLimit);
  const budgetUtilization =
    budgetLimit && budgetLimit > 0 ? tokenCount / budgetLimit : asNumber(rec.budgetUtilization);

  const delegated = await delegateTrustPostToWorker({
    path: "context-budget",
    auth,
    body: rec,
    traceId,
  });
  if (delegated) return delegated;

  let id;
  try {
    id = await ingestContextBudget({
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      sessionId,
      agentId,
      environment,
      runtimeStack,
      eventType,
      tokenCount,
      tokenDelta: asInt(rec.tokenDelta),
      contextSourceMix: isRecord(rec.contextSourceMix)
        ? (rec.contextSourceMix as Record<string, number>)
        : undefined,
      budgetLimit,
      budgetUtilization,
      governanceAction: asString(rec.governanceAction) as
        "ALLOW" | "WARN" | "ESCALATE" | "REVIEW" | undefined,
      policyRef: asString(rec.policyRef),
    });
  } catch (err) {
    console.error("[trust/context-budget] ingestContextBudgetEvent failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  if (eventType === "BUDGET_BREACH") {
    recordTrustOperation({
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      eventType: "CONTEXT_BUDGET_BREACH",
      sourceId: id ?? undefined,
      sourceTable: "context_budget_event",
      actorId: auth.actorId,
      payload: {
        sessionId,
        agentId,
        environment,
        runtimeStack,
        tokenCount,
        budgetLimit,
        budgetUtilization,
      },
    }).catch(swallow("recordTrustOperation", undefined));
  }

  return withTraceId(
    Response.json({ ok: true, id, meta: makeMeta(traceId) }, { status: 201 }),
    traceId,
  );
}

export { handleGetApiTrustContextBudget as GET };
export { handlePostApiTrustContextBudget as POST };
