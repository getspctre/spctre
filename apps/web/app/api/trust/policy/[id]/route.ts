import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { deleteTrustPolicy, recordTrustOperation, updateTrustPolicy } from "@/lib/domains/trust/service";
import { isDemoTenant } from "@/lib/demo-guard";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import type { TrustCalibrationPolicy } from "@spctre/policy-schema";
import { asInt, asNumber, asString } from "../../_shared";

export const dynamic = "force-dynamic";

async function handlePatchApiTrustPolicyByid(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  const { id } = await params;

  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  if (isDemoTenant(ctx.tenantId)) {
    return withTraceId(Response.json({ error: "Trust policy management is not available in Demo Mode.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const rec = body as Record<string, unknown>;
  const consequenceTier = asString(rec.consequenceTier) as TrustCalibrationPolicy["consequenceTier"];
  const VALID_CONSEQUENCE_TIERS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  if (consequenceTier && !VALID_CONSEQUENCE_TIERS.has(consequenceTier)) {
    return withTraceId(Response.json({ error: "consequenceTier must be LOW, MEDIUM, HIGH, or CRITICAL.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  let updated;
  try {
    updated = await updateTrustPolicy({ id, tenantId: ctx.tenantId, patch: {
      name: asString(rec.name),
      description: asString(rec.description),
      enabled: rec.enabled === true ? true : rec.enabled === false ? false : undefined,
      agentClass: asString(rec.agentClass),
      environment: asString(rec.environment),
      connector: asString(rec.connector),
      consequenceTier: consequenceTier || undefined,
      decayEnabled: rec.decayEnabled === true ? true : rec.decayEnabled === false ? false : undefined,
      decayRate: asNumber(rec.decayRate),
      decayPeriodHours: asInt(rec.decayPeriodHours),
      decayFloor: asNumber(rec.decayFloor),
      warnThreshold: asNumber(rec.warnThreshold),
      escalateThreshold: asNumber(rec.escalateThreshold),
      reviewThreshold: asNumber(rec.reviewThreshold),
      contextWarnThreshold: asInt(rec.contextWarnThreshold),
      contextEscalateThreshold: asInt(rec.contextEscalateThreshold),
    } });
  } catch (err) {
    console.error("[trust/policy/[id]] updateTrustCalibrationPolicy failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!updated) {
    return withTraceId(Response.json({ error: "Policy not found or update failed.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  recordTrustOperation({
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    eventType: "TRUST_SCORE_CHANGE",
    sourceId: id,
    sourceTable: "trust_calibration_policy",
    actorId: session.principalId,
    payload: { action: "POLICY_UPDATED", policyId: id },
  }).catch(() => {});

  return withTraceId(Response.json({ policy: updated, meta: makeMeta(traceId) }), traceId);
}

async function handleDeleteApiTrustPolicyByid(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  const { id } = await params;

  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  if (isDemoTenant(ctx.tenantId)) {
    return withTraceId(Response.json({ error: "Trust policy management is not available in Demo Mode.", meta: makeMeta(traceId) }, { status: 403 }), traceId);
  }

  let ok;
  try {
    ok = await deleteTrustPolicy({ id, tenantId: ctx.tenantId });
  } catch (err) {
    console.error("[trust/policy/[id]] deleteTrustCalibrationPolicy failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
  if (!ok) {
    return withTraceId(Response.json({ error: "Policy not found or could not be deleted.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  recordTrustOperation({
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    eventType: "TRUST_SCORE_CHANGE",
    sourceId: id,
    sourceTable: "trust_calibration_policy",
    actorId: session.principalId,
    payload: { action: "POLICY_DELETED", policyId: id },
  }).catch(() => {});

  return withTraceId(Response.json({ ok: true, meta: makeMeta(traceId) }), traceId);
}

export { handlePatchApiTrustPolicyByid as PATCH };
export { handleDeleteApiTrustPolicyByid as DELETE };
