import { evaluateTrustDecision, ingestContextBudget, listTrustPolicies, recordTrustOperation } from "@/lib/domains/trust/service";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import type { TrustCalibrationPolicy } from "@spctre/policy-schema";
import { asInt, asNumber, asString, delegateTrustPostToWorker, resolveAuth, VALID_STACKS } from "../_shared";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const VALID_CONSEQUENCE_TIERS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

interface TrustEvaluateFields {
  trustScore?: number;
  contextTokens?: number;
  budgetLimit?: number;
  agentClass?: string;
  environment?: string;
  connector?: string;
  consequenceTier?: TrustCalibrationPolicy["consequenceTier"];
  sessionId?: string;
  agentId?: string;
  runtimeStack?: string;
}

// Fire-and-forget breach telemetry: context-budget ingest (when the breach is
// token-driven and fully attributed) plus an operations-log entry.
function recordBreachTelemetry(
  result: ReturnType<typeof evaluateTrustDecision>,
  fields: TrustEvaluateFields,
  auth: { tenantId: string; workspaceId: string; actorId: string }
): void {
  const { trustScore, contextTokens, budgetLimit, agentClass, environment, connector, consequenceTier, sessionId, agentId, runtimeStack } = fields;

  const isContextBreach = contextTokens !== undefined && result.reason.includes("token count");
  if (isContextBreach && sessionId && agentId && environment && runtimeStack && VALID_STACKS.has(runtimeStack)) {
    ingestContextBudget({
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      sessionId,
      agentId,
      environment,
      runtimeStack,
      eventType: result.action === "ESCALATE" ? "BUDGET_BREACH" : "TOKEN_GROWTH",
      tokenCount: contextTokens!,
      budgetLimit: budgetLimit ?? undefined,
      budgetUtilization: result.budgetUtilization,
      governanceAction: result.action,
      policyRef: result.matchedPolicyId,
    }).catch(swallow("ingestContextBudget", undefined));
  }

  const opsEventType = isContextBreach ? "CONTEXT_BUDGET_BREACH" as const : "TRUST_POLICY_BREACH" as const;
  recordTrustOperation({
    tenantId: auth.tenantId,
    workspaceId: auth.workspaceId,
    eventType: opsEventType,
    sourceId: result.matchedPolicyId,
    sourceTable: "trust_calibration_policy",
    actorId: auth.actorId,
    payload: {
      action: result.action,
      reason: result.reason,
      trustScore,
      contextTokens,
      budgetUtilization: result.budgetUtilization,
      matchedPolicyId: result.matchedPolicyId,
      agentClass,
      environment,
      connector,
      consequenceTier,
      agentId,
      sessionId,
    },
  }).catch(swallow("recordTrustOperation", undefined));
}

async function handlePostApiTrustEvaluate(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await resolveAuth(request);
  if (!auth.ok) return withTraceId(Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const rec = body as Record<string, unknown>;
  const trustScore = asNumber(rec.trustScore);
  const contextTokens = asInt(rec.contextTokens);
  const budgetLimit = asInt(rec.budgetLimit);
  const agentClass = asString(rec.agentClass);
  const environment = asString(rec.environment);
  const connector = asString(rec.connector);
  const consequenceTier = asString(rec.consequenceTier) as TrustCalibrationPolicy["consequenceTier"];
  const sessionId = asString(rec.sessionId);
  const agentId = asString(rec.agentId);
  const runtimeStack = asString(rec.runtimeStack);

  if (trustScore !== undefined && (trustScore < 0 || trustScore > 1)) {
    return withTraceId(Response.json({ error: "trustScore must be between 0 and 1.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (consequenceTier && !VALID_CONSEQUENCE_TIERS.has(consequenceTier)) {
    return withTraceId(Response.json({ error: "consequenceTier must be LOW, MEDIUM, HIGH, or CRITICAL.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const delegated = await delegateTrustPostToWorker({ path: "evaluate", auth, body: rec, traceId });
  if (delegated) return delegated;

  let policies;
  try {
    policies = await listTrustPolicies({ tenantId: auth.tenantId, workspaceId: auth.workspaceId, enabledOnly: true });
  } catch (err) {
    console.error("[trust/evaluate] listTrustCalibrationPolicies failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  const result = evaluateTrustDecision({
    trustScore,
    contextTokens,
    budgetLimit,
    agentClass,
    environment,
    connector,
    consequenceTier: consequenceTier || undefined,
    policies,
  });

  if (result.action !== "ALLOW") {
    recordBreachTelemetry(
      result,
      { trustScore, contextTokens, budgetLimit, agentClass, environment, connector, consequenceTier, sessionId, agentId, runtimeStack },
      auth
    );
  }

  return withTraceId(Response.json({
    result,
    gatewayHint: {
      trustScore,
      contextBudget: contextTokens,
      riskLevel: result.recommendedRiskLevel,
    },
    meta: makeMeta(traceId),
  }), traceId);
}

export { handlePostApiTrustEvaluate as POST };
