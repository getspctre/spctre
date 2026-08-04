import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import {
  createTrustPolicy,
  listTrustPolicies,
  recordTrustOperation,
} from "@/lib/domains/trust/service";
import { isDemoTenant } from "@/lib/demo-guard";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import type { TrustCalibrationPolicy } from "@spctre/policy-schema";
import { asInt, asNumber, asString } from "../_shared";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiTrustPolicy(request: Request) {
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
  const enabledOnly = url.searchParams.get("enabled") === "true";
  const limit = Math.max(
    1,
    Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );

  let policies;
  try {
    policies = await listTrustPolicies({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      enabledOnly,
      limit,
    });
  } catch (err) {
    console.error("[trust/policy] listTrustCalibrationPolicies failed", err);
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
      policies,
      count: policies.length,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

async function handlePostApiTrustPolicy(request: Request) {
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

  if (isDemoTenant(ctx.tenantId)) {
    return withTraceId(
      Response.json(
        {
          error: "Trust policy management is not available in Demo Mode.",
          meta: makeMeta(traceId),
        },
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
  const name = asString(rec.name);
  if (!name)
    return withTraceId(
      Response.json({ error: "name is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );

  const consequenceTier = asString(
    rec.consequenceTier,
  ) as TrustCalibrationPolicy["consequenceTier"];
  const VALID_CONSEQUENCE_TIERS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  if (consequenceTier && !VALID_CONSEQUENCE_TIERS.has(consequenceTier)) {
    return withTraceId(
      Response.json(
        {
          error: "consequenceTier must be LOW, MEDIUM, HIGH, or CRITICAL.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }

  let policy;
  try {
    policy = await createTrustPolicy({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name,
      description: asString(rec.description),
      agentClass: asString(rec.agentClass),
      environment: asString(rec.environment),
      connector: asString(rec.connector),
      consequenceTier: consequenceTier || undefined,
      decayEnabled: rec.decayEnabled === true,
      decayRate: asNumber(rec.decayRate),
      decayPeriodHours: asInt(rec.decayPeriodHours),
      decayFloor: asNumber(rec.decayFloor),
      warnThreshold: asNumber(rec.warnThreshold),
      escalateThreshold: asNumber(rec.escalateThreshold),
      reviewThreshold: asNumber(rec.reviewThreshold),
      contextWarnThreshold: asInt(rec.contextWarnThreshold),
      contextEscalateThreshold: asInt(rec.contextEscalateThreshold),
      createdBy: session.principalId,
    });
  } catch (err) {
    console.error("[trust/policy] createTrustCalibrationPolicy failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  if (!policy) {
    return withTraceId(
      Response.json(
        { error: "Failed to create trust calibration policy.", meta: makeMeta(traceId) },
        { status: 500 },
      ),
      traceId,
    );
  }

  recordTrustOperation({
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    eventType: "TRUST_SCORE_CHANGE",
    sourceId: policy.id,
    sourceTable: "trust_calibration_policy",
    actorId: session.principalId,
    payload: { action: "POLICY_CREATED", policyId: policy.id, name: policy.name },
  }).catch(swallow("recordTrustOperation", undefined));

  return withTraceId(Response.json({ policy, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handleGetApiTrustPolicy as GET };
export { handlePostApiTrustPolicy as POST };
