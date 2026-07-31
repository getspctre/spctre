import { ingestTrustScore, recordTrustOperation } from "@/lib/domains/trust/service";

import type { TrustScoreSource } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { asNumber, asString, delegateTrustPostToWorker, resolveAuth, VALID_STACKS } from "../_shared";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const VALID_SOURCES = new Set<TrustScoreSource>([
  "EVIDENCE_INGEST", "POLICY_EVALUATION", "MANUAL", "IDENTITY_EVENT", "SYSTEM",
]);

async function handlePostApiTrustIngest(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await resolveAuth(request);
  if (!auth.ok) return withTraceId(Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const rec = body as Record<string, unknown>;
  const agentId = asString(rec.agentId);
  const environment = asString(rec.environment);
  const runtimeStack = asString(rec.runtimeStack);
  const trustScore = asNumber(rec.trustScore);
  const source = asString(rec.source) as TrustScoreSource | undefined;
  const sourceRef = asString(rec.sourceRef);
  const reason = asString(rec.reason);

  if (!agentId) return withTraceId(Response.json({ error: "agentId is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  if (!environment) return withTraceId(Response.json({ error: "environment is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  if (!runtimeStack || !VALID_STACKS.has(runtimeStack)) {
    return withTraceId(Response.json({ error: "runtimeStack must be a supported runtime stack.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (trustScore === undefined || trustScore < 0 || trustScore > 1) {
    return withTraceId(Response.json({ error: "trustScore must be a number between 0 and 1.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (!source || !VALID_SOURCES.has(source)) {
    return withTraceId(Response.json({ error: "source must be a valid TrustScoreSource.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const delegated = await delegateTrustPostToWorker({ path: "ingest", auth, body: rec, traceId });
  if (delegated) return delegated;

  try {
    await ingestTrustScore({
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      agentId,
      environment,
      runtimeStack,
      trustScore,
      source,
      sourceRef,
      reason,
    });
  } catch (err) {
    console.error("[trust/ingest] ingestTrustScoreEvent failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  recordTrustOperation({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    eventType: "TRUST_SCORE_CHANGE",
    sourceId: agentId,
    sourceTable: "agt_trust_score_event",
    actorId: auth.actorId,
    payload: { agentId, environment, runtimeStack, trustScore, source, sourceRef },
  }).catch(swallow("recordTrustOperation", undefined));

  return withTraceId(Response.json({ ok: true, agentId, trustScore, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handlePostApiTrustIngest as POST };
