import type { EvidenceIngestInput } from "@spctre/api-contracts";
import { redactAndBoundJson } from "@spctre/api-contracts";
import {
  evaluateGatewayDecision,
  ingestAgtRuntimeDecision,
  type AgtRuntimeDecisionInput,
  type ExecutionContext,
  type GatewayDecisionInput,
  type OrchestratorRef,
  type PluginSource,
  type RuntimeDecisionEvidenceRecord,
  type SkillContext,
} from "@spctre/policy-schema";
import { persistGatewayDecision } from "@/lib/repositories/gateway";
import { isGatewayEnabled } from "@/lib/platform/config";
import {
  mergePublishedPolicyDecision,
  resolvePublishedPolicyDecision,
} from "@/lib/policy/published-enforcement";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  countMonthlyEvidenceEvents,
  countTotalEvidenceEvents,
  ensureEvidenceDemoTenant,
  insertRuntimeEvidenceWithDedup,
  isEvidenceDatabaseConfigured,
  validateEvidencePolicyContextBoundary,
  validateEvidenceWorkspaceBoundary,
} from "@/lib/repositories/evidence";
import { getCommercialProfile } from "@/lib/repositories/workspace";
import { ingestTrustScoreEvent } from "@/lib/repositories/trust";
import { recordConversionTelemetry } from "@/lib/repositories/onboarding/telemetry";
import { getPublishedBlueprintContext } from "@/lib/repositories/agent-blueprints";
import { resolveCanonicalAgentId } from "@/lib/repositories/identity";
import { resolveTenantIdOrDemo, resolveWorkspaceIdOrDemo } from "@/lib/repositories/auth/session";
import { isDemoTenant } from "@/lib/demo-guard";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { logger } from "@spctre/platform/logging";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { INGEST_LAG_WARN_MS } from "@spctre/platform/slos";
import { swallow } from "@/lib/platform/swallow";
import { runWithTenantContext } from "@/lib/tenant-context";

const EVIDENCE_ROUTE = "/api/evidence";
const EVIDENCE_REVALIDATE_PATHS = ["/evidence", "/compliance", "/agents", "/escalations"];

type IngestionSource = "mcp" | "hook" | "gateway";
type GatewayEvaluation = ReturnType<typeof evaluateGatewayDecision>;

export type EvidenceIngestServiceResult = {
  status: number;
  body: Record<string, unknown>;
  revalidatePaths?: string[];
  spanAttributes?: Record<string, string>;
};

function apiError(status: number, error: string): EvidenceIngestServiceResult {
  incrementCounter("spctre.api.errors", 1, {
    "http.route": EVIDENCE_ROUTE,
    "http.response.status_code": status,
  });
  return { status, body: { error } };
}

function isGovernanceActiveSignal(input: AgtRuntimeDecisionInput): boolean {
  return (
    input.action === "governance_active" && input.policyRefs.includes("system.governance_active")
  );
}

function resolveIngestionSource(
  request: Request,
  rawPayload: Record<string, unknown>,
): IngestionSource {
  const header = (request.headers.get("x-spctre-source") ?? "").toLowerCase().trim();
  if (header === "mcp") return "mcp";
  if (header === "hook") return "hook";
  if (header === "gateway") return "gateway";
  const body = typeof rawPayload.sourceType === "string" ? rawPayload.sourceType.toLowerCase() : "";
  if (body === "mcp") return "mcp";
  if (body === "gateway") return "gateway";
  const ingestMode = typeof rawPayload.ingestMode === "string" ? rawPayload.ingestMode : "";
  if (ingestMode === "gateway") return "gateway";
  return "hook";
}

function emitDedupTelemetry(
  decisionId: string,
  tenantId: string,
  incomingSource: IngestionSource,
): void {
  logger.warn("evidence.dedup_suppressed", {
    decision_id: decisionId,
    tenant_id: tenantId,
    incoming_source: incomingSource,
    suppressed_at: new Date().toISOString(),
  });
}

async function authenticateRuntimeRequest(
  request: Request,
  input: AgtRuntimeDecisionInput,
): Promise<
  | {
      ok: true;
      tenantId: string;
      workspaceId: string;
      principalId: string;
      connector?: string;
      scopes: string[];
      evidenceExportGrants: Array<{ revisionId: string; notBefore: string; notAfter?: string }>;
    }
  | { ok: false; error: string }
> {
  const requestedTenantId =
    (request.headers.get("x-spctre-tenant-id") ?? "").trim() ||
    input.tenantId ||
    resolveTenantIdOrDemo(null);
  const requestedWorkspaceId =
    (request.headers.get("x-spctre-workspace-id") ?? "").trim() ||
    input.workspaceId ||
    resolveWorkspaceIdOrDemo(null);

  if (!hasBearerToken(request)) {
    return { ok: false, error: "Missing bearer token. Issue one with: spctre init" };
  }

  const tokenAuth = await authenticateServiceToken(request, "evidence:write");
  if (!tokenAuth.ok) return tokenAuth;
  if (input.action === "heartbeat" && !tokenAuth.auth.scopes.includes("heartbeat:write")) {
    return { ok: false, error: "Token is missing heartbeat:write scope." };
  }
  if (requestedTenantId && requestedTenantId !== tokenAuth.auth.tenantId) {
    return { ok: false, error: "Tenant is outside this token scope." };
  }
  if (requestedWorkspaceId && requestedWorkspaceId !== tokenAuth.auth.workspaceId) {
    return { ok: false, error: "Workspace is outside this token scope." };
  }
  return {
    ok: true,
    tenantId: tokenAuth.auth.tenantId,
    workspaceId: tokenAuth.auth.workspaceId,
    principalId: tokenAuth.auth.principalId,
    connector: tokenAuth.auth.connector,
    scopes: tokenAuth.auth.scopes,
    evidenceExportGrants: tokenAuth.auth.evidenceExportGrants,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Agent-supplied free text can carry PII/secrets; redact before it enters the
// hash-chained evidence record, where selective deletion is no longer possible.
function redactFreeText(value: string | undefined): string | undefined {
  return typeof value === "string" ? (redactAndBoundJson(value) as string) : undefined;
}

function redactStructured<T>(value: T | undefined): T | undefined {
  return value === undefined || value === null ? undefined : (redactAndBoundJson(value) as T);
}

function buildAgtInput(parsed: EvidenceIngestInput, rawPayload: unknown): AgtRuntimeDecisionInput {
  const rawEvidence = parsed.rawEvidence ?? (rawPayload as Record<string, unknown>);
  return {
    decisionId: parsed.decisionId,
    tenantId: resolveTenantIdOrDemo(parsed.tenantId),
    workspaceId: resolveWorkspaceIdOrDemo(parsed.workspaceId) ?? "",
    environment: parsed.environment,
    runtimeTarget: parsed.runtimeTarget,
    agentId: parsed.agentId,
    connector: parsed.connector,
    action: parsed.action,
    status: parsed.status,
    reason: redactFreeText(parsed.reason) ?? "",
    policyRefs: parsed.policyRefs ?? [],
    artifactHash: parsed.artifactHash ?? "",
    policyContext: parsed.policyContext ?? [],
    latencyMs: parsed.latencyMs ?? 0,
    createdAt: parsed.createdAt ?? new Date().toISOString(),
    rawEvidence: redactAndBoundJson(rawEvidence) as Record<string, unknown>,
    toolIntent: redactFreeText(parsed.toolIntent),
    planSummary: redactFreeText(parsed.planSummary),
    toolParameters: redactStructured(parsed.toolParameters) as Record<string, unknown> | undefined,
    triggerKind: parsed.triggerKind,
    layer: parsed.layer,
    executionContext: redactStructured(parsed.executionContext as ExecutionContext | undefined),
    parentAgentId: parsed.parentAgentId,
    traceId: parsed.traceId,
    orchestratorRef: parsed.orchestratorRef as OrchestratorRef | undefined,
    pluginSource: parsed.pluginSource as PluginSource | undefined,
    skillContext: redactStructured(parsed.skillContext as SkillContext | undefined),
    webhookSource: parsed.webhookSource,
    trustLevel: parsed.trustLevel,
    catalogProvider: parsed.catalogProvider,
  };
}

function validateRequiredEvidenceFields(
  parsed: EvidenceIngestInput,
): EvidenceIngestServiceResult | null {
  if (parsed.ingestMode === "gateway") return null;
  if (!parsed.policyRefs?.length) {
    return {
      status: 400,
      body: { error: "policyRefs must include at least one policy reference." },
    };
  }
  if (!parsed.artifactHash) {
    return { status: 400, body: { error: "artifactHash is required." } };
  }
  if (!parsed.policyContext?.length) {
    return {
      status: 400,
      body: { error: "policyContext must include at least one valid context node." },
    };
  }
  return null;
}

function executionTraceFrom(
  rawPayload: Record<string, unknown>,
): Record<string, unknown> | unknown[] | null {
  if (
    rawPayload.executionTrace &&
    typeof rawPayload.executionTrace === "object" &&
    !Array.isArray(rawPayload.executionTrace)
  ) {
    return redactAndBoundJson(rawPayload.executionTrace) as Record<string, unknown>;
  }
  return Array.isArray(rawPayload.executionTrace)
    ? (redactAndBoundJson(rawPayload.executionTrace) as unknown[])
    : null;
}

/**
 * Extract the narrowly-scoped runtime fact emitted by compatible agents. This
 * is deliberately not a generic raw-evidence hash: only the documented
 * `spctre-runtime-facts/v1` envelope is eligible for byte-exact custody, and
 * its revision must be one of the authoritative policy-context revisions.
 */
export function policyContentReferenceFromEvidence(
  evidence: RuntimeDecisionEvidenceRecord,
): { contentHash: string; revisionId: string } | undefined {
  const facts = evidence.rawEvidence.spctre_runtime;
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return undefined;
  const factsRecord = facts as Record<string, unknown>;
  if (factsRecord.schema !== "spctre-runtime-facts/v1") return undefined;
  const policy = factsRecord.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return undefined;
  const contentHash = (policy as Record<string, unknown>).content_hash;
  if (typeof contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    return undefined;
  }

  const revisionIds = (policy as Record<string, unknown>).revision_ids;
  if (!Array.isArray(revisionIds)) return undefined;
  const contextByRevisionId = new Map(
    evidence.policyContext.map((context) => [context.revisionId, context]),
  );
  const matchingRevisionId = revisionIds.find(
    (revisionId): revisionId is string =>
      typeof revisionId === "string" && contextByRevisionId.has(revisionId),
  );
  return matchingRevisionId ? { contentHash, revisionId: matchingRevisionId } : undefined;
}

/**
 * A policy-content reference is an authorization-bearing custody claim, not
 * merely evidence metadata. The runtime token must be bound to the same
 * connector and an active revision grant covering the evidence timestamp.
 */
export function validatePolicyContentReferenceAuthorization(
  evidence: RuntimeDecisionEvidenceRecord,
  auth: {
    connector?: string;
    scopes: string[];
    evidenceExportGrants: Array<{ revisionId: string; notBefore: string; notAfter?: string }>;
  },
): string | undefined {
  const reference = policyContentReferenceFromEvidence(evidence);
  if (!reference) return undefined;
  if (!auth.scopes.includes("evidence:export") || !auth.connector) {
    return "Policy content references require an evidence:export token bound to a connector.";
  }
  if (auth.connector !== evidence.connector) {
    return "Policy content reference connector is outside this token scope.";
  }
  const createdAt = new Date(evidence.createdAt).getTime();
  const granted = auth.evidenceExportGrants.some((grant) =>
    grant.revisionId === reference.revisionId &&
    createdAt >= new Date(grant.notBefore).getTime() &&
    (!grant.notAfter || createdAt < new Date(grant.notAfter).getTime()),
  );
  return granted ? undefined : "Policy content reference revision is outside this token grant.";
}

async function persistEvidence(input: {
  tenantId: string;
  workspaceId: string;
  evidence: RuntimeDecisionEvidenceRecord;
  rawPayload: Record<string, unknown>;
  sourceType: IngestionSource;
  startedAt: number;
}): Promise<EvidenceIngestServiceResult | null> {
  const { tenantId, workspaceId, evidence, rawPayload, sourceType, startedAt } = input;
  const engineVersion =
    typeof rawPayload.engineVersion === "string" ? rawPayload.engineVersion.trim() || null : null;

  try {
    await ensureEvidenceDemoTenant();

    const insertResult = await insertRuntimeEvidenceWithDedup({
      tenantId,
      workspaceId,
      evidence,
      rawEvidenceWithSource: {
        ...evidence.rawEvidence,
        runtimeTarget: evidence.runtimeTarget,
        toolIntent: evidence.toolIntent,
        planSummary: evidence.planSummary,
        toolParameters: evidence.toolParameters,
        triggerKind: evidence.triggerKind,
        layer: evidence.layer,
        executionContext: evidence.executionContext,
        parentAgentId: evidence.parentAgentId,
        traceId: evidence.traceId,
        orchestratorRef: evidence.orchestratorRef,
        pluginSource: evidence.pluginSource,
        skillContext: evidence.skillContext,
        webhookSource: evidence.webhookSource,
        trustLevel: evidence.trustLevel,
        catalogProvider: evidence.catalogProvider,
        blueprintContext: evidence.blueprintContext,
        _source: sourceType,
      },
      executionTrace: executionTraceFrom(rawPayload),
      engineVersion,
      policyContentReference: policyContentReferenceFromEvidence(evidence),
    });

    if (!insertResult.inserted) {
      emitDedupTelemetry(evidence.decisionId, tenantId, sourceType);
      incrementCounter("spctre.evidence.deduplicated", 1, { source: sourceType });
      recordDuration("spctre.evidence.ingest.duration", Date.now() - startedAt, {
        outcome: "deduplicated",
      });
      return { status: 200, body: { evidence, deduplicated: true } };
    }
  } catch (err) {
    incrementCounter("spctre.api.errors", 1, {
      "http.route": EVIDENCE_ROUTE,
      "http.response.status_code": 500,
    });
    logger.error("Evidence ingest database error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, body: { error: "Service temporarily unavailable." } };
  }

  return null;
}

function emitPostInsertSideEffects(input: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  evidence: RuntimeDecisionEvidenceRecord;
  rawPayload: Record<string, unknown>;
  governanceActiveSignal: boolean;
}): void {
  const { tenantId, workspaceId, principalId, evidence, rawPayload, governanceActiveSignal } =
    input;

  appendOperationsLog({
    tenantId,
    workspaceId,
    eventType: "EVIDENCE_INGEST",
    sourceId: evidence.decisionId,
    sourceTable: "runtime_evidence_event",
    actorId: principalId,
    payload: {
      agentId: evidence.agentId,
      connector: evidence.connector,
      action: evidence.action,
      status: evidence.status,
      artifactHash: evidence.artifactHash,
      runtimeStack: evidence.runtimeTarget.stack,
      governanceActive: governanceActiveSignal,
      runtimeAdapter: evidence.runtimeTarget.adapter,
      blueprintRevisionId: evidence.blueprintContext?.revisionId,
    },
  }).catch(swallow("appendOperationsLog", undefined));

  const incomingTrustScore = numberValue(rawPayload.trustScore);
  if (incomingTrustScore !== undefined) {
    ingestTrustScoreEvent({
      tenantId,
      workspaceId,
      agentId: evidence.agentId,
      environment: evidence.environment,
      runtimeStack: evidence.runtimeTarget.stack,
      trustScore: incomingTrustScore,
      source: "EVIDENCE_INGEST",
      sourceRef: evidence.decisionId,
    }).catch(swallow("ingestTrustScoreEvent", undefined));
  }
}

async function evaluateAndPersistGatewayDecision(input: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  evidence: RuntimeDecisionEvidenceRecord;
  rawPayload: Record<string, unknown>;
}): Promise<GatewayEvaluation | undefined> {
  if (!isGatewayEnabled()) return undefined;

  const { tenantId, workspaceId, principalId, evidence, rawPayload } = input;

  try {
    const firstContext = evidence.policyContext[0];
    const gatewayInput: GatewayDecisionInput = {
      decisionId: evidence.decisionId,
      artifactHash: evidence.artifactHash,
      policyContext: evidence.policyContext,
      reason: evidence.reason,
      consequence: stringValue(rawPayload.consequence),
      customerTier: stringValue(rawPayload.customerTier),
      confidence: numberValue(rawPayload.confidence),
      amountUsd: numberValue(rawPayload.amountUsd),
      dataSensitivity: stringValue(rawPayload.dataSensitivity),
      trustScore: numberValue(rawPayload.trustScore),
      contextBudget:
        typeof rawPayload.contextBudget === "number"
          ? Math.trunc(rawPayload.contextBudget)
          : undefined,
    };

    // The threshold evaluator alone would record an authored ESCALATE/DENY
    // rule as PROCEED. Published rules decide first; see
    // @/lib/policy/published-enforcement.
    const policyDecision = isDemoTenant(tenantId)
      ? null
      : await resolvePublishedPolicyDecision({
          tenantId,
          workspaceId,
          connector: evidence.connector,
          action: evidence.action,
          toolIntent: evidence.toolIntent,
          planSummary: evidence.planSummary,
          toolParameters: evidence.toolParameters,
        });
    const gateway = mergePublishedPolicyDecision(
      evaluateGatewayDecision(gatewayInput),
      policyDecision,
    );

    if (!isDemoTenant(tenantId)) {
      await persistGatewayDecision({
        decisionId: evidence.decisionId,
        tenantId,
        workspaceId,
        firstContext,
        artifactHash: evidence.artifactHash,
        outcome: gateway.outcome,
        reason: gateway.reason,
        consequence: gatewayInput.consequence,
        customerTier: gatewayInput.customerTier,
        confidence: gatewayInput.confidence,
        amountUsd: gatewayInput.amountUsd,
        dataSensitivity: gatewayInput.dataSensitivity,
        trustScore: gatewayInput.trustScore,
        contextBudget: gatewayInput.contextBudget,
        riskLevel: gateway.riskLevel,
        evaluatedBy: principalId,
        shouldQueue: gateway.shouldQueue,
        slaHours: gateway.slaHours,
        toolIntent: evidence.toolIntent,
        planSummary: evidence.planSummary,
        toolParameters: evidence.toolParameters,
      });
    }

    return gateway;
  } catch (err) {
    logger.warn("Evidence gateway evaluation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function recordSuccessfulIngestMetrics(input: {
  tenantId: string;
  workspaceId: string;
  evidence: RuntimeDecisionEvidenceRecord;
  gateway: GatewayEvaluation | undefined;
  sourceType: IngestionSource;
  governanceActiveSignal: boolean;
  startedAt: number;
}): Record<string, string> {
  const {
    tenantId,
    workspaceId,
    evidence,
    gateway,
    sourceType,
    governanceActiveSignal,
    startedAt,
  } = input;

  incrementCounter("spctre.evidence.ingested", 1, { source: sourceType, status: evidence.status });
  if (governanceActiveSignal) {
    incrementCounter("spctre.governance.active", 1, {
      source: sourceType,
      runtime_stack: evidence.runtimeTarget.stack,
      runtime_adapter: evidence.runtimeTarget.adapter ?? "unknown",
    });
  }
  recordDuration("spctre.evidence.ingest.duration", Date.now() - startedAt, {
    outcome: "created",
    source: sourceType,
  });

  const ingestLagMs = Date.now() - new Date(evidence.createdAt).getTime();
  recordDuration("spctre.evidence.ingest.lag", ingestLagMs, { source: sourceType });
  if (ingestLagMs > INGEST_LAG_WARN_MS) {
    logger.warn("Evidence ingest lag above threshold", {
      "spctre.evidence.ingest_lag_ms": ingestLagMs,
      "spctre.evidence.decision_id": evidence.decisionId,
      source: sourceType,
    });
  }

  return {
    "spctre.tenant_id": tenantId,
    "spctre.workspace_id": workspaceId,
    "spctre.evidence.status": evidence.status,
    "spctre.gateway.outcome": gateway?.outcome ?? "not_evaluated",
  };
}

export async function ingestRuntimeEvidence(input: {
  request: Request;
  parsed: EvidenceIngestInput;
  rawPayload: unknown;
  startedAt: number;
}): Promise<EvidenceIngestServiceResult> {
  const { request, parsed, rawPayload, startedAt } = input;

  if (!isEvidenceDatabaseConfigured()) {
    return apiError(503, "Database not configured.");
  }

  const requiredFieldsError = validateRequiredEvidenceFields(parsed);
  if (requiredFieldsError) return requiredFieldsError;

  const agtInput = buildAgtInput(parsed, rawPayload);
  const auth = await authenticateRuntimeRequest(request, agtInput);
  if (!auth.ok) {
    return apiError(401, auth.error);
  }

  const { tenantId, workspaceId, principalId } = auth;

  return runWithTenantContext(tenantId, async () => {
    // Every framework adapter may report its local surface identity. Resolve it
    // once at ingress so evidence, Blueprint context, trust, and review all use
    // the same canonical agent across runtimes.
    agtInput.agentId = await resolveCanonicalAgentId({
      tenantId,
      workspaceId,
      agentId: agtInput.agentId,
    });

    const publishedBlueprint = await getPublishedBlueprintContext({
      tenantId,
      workspaceId,
      agentId: agtInput.agentId,
      policyRevisionIds: agtInput.policyContext.map((context) => context.revisionId),
    }).catch(swallow("getPublishedBlueprintContext", undefined));
    const scopedInput: AgtRuntimeDecisionInput = {
      ...agtInput,
      tenantId,
      workspaceId,
      blueprintContext: publishedBlueprint,
    };

    // These checks are independent of one another, so run them concurrently
    // rather than strictly sequentially on the ingest hot path.
    // See database-optimizations-audit finding 4.
    const [profile, workspaceCheck, contextCheck] = await Promise.all([
      getCommercialProfile(tenantId).catch(swallow("getCommercialProfile", null)),
      validateEvidenceWorkspaceBoundary(tenantId, workspaceId),
      validateEvidencePolicyContextBoundary(scopedInput.policyContext, tenantId, workspaceId),
    ]);

    // Enforce Free Tier (HOSTED_TRIAL) 1,000 total retained governed event capacity limit.
    // The count depends on the profile plan, so it stays sequential after the fetch.
    if (profile?.planCode === "HOSTED_TRIAL") {
      const totalCount = await countTotalEvidenceEvents(tenantId);
      if (totalCount >= 1000) {
        return apiError(
          429,
          "Evidence ingestion limit exceeded. Free trial is limited to 1,000 total retained governed events. Upgrade to a paid plan.",
        );
      }
    }

    if (!workspaceCheck.ok) {
      return apiError(403, workspaceCheck.error);
    }

    if (!contextCheck.ok) {
      return apiError(403, contextCheck.error);
    }

    const evidence = ingestAgtRuntimeDecision(scopedInput);
    const referenceAuthorizationError = validatePolicyContentReferenceAuthorization(evidence, auth);
    if (referenceAuthorizationError) return apiError(403, referenceAuthorizationError);
    const governanceActiveSignal = isGovernanceActiveSignal(evidence);
    const rawPayloadRecord = parsed as Record<string, unknown>;
    const sourceType = resolveIngestionSource(request, rawPayloadRecord);

    const persistResult = await persistEvidence({
      tenantId,
      workspaceId,
      evidence,
      rawPayload: rawPayloadRecord,
      sourceType,
      startedAt,
    });
    if (persistResult) return persistResult;

    // Trigger FIRST_EVIDENCE_INGEST conversion telemetry asynchronously
    recordConversionTelemetry(tenantId, "FIRST_EVIDENCE_INGEST").catch(
      swallow("recordConversionTelemetry", undefined),
    );

    emitPostInsertSideEffects({
      tenantId,
      workspaceId,
      principalId,
      evidence,
      rawPayload: rawPayloadRecord,
      governanceActiveSignal,
    });

    const gateway = await evaluateAndPersistGatewayDecision({
      tenantId,
      workspaceId,
      principalId,
      evidence,
      rawPayload: rawPayloadRecord,
    });

    const spanAttributes = recordSuccessfulIngestMetrics({
      tenantId,
      workspaceId,
      evidence,
      gateway,
      sourceType,
      governanceActiveSignal,
      startedAt,
    });

    return {
      status: 201,
      body: { evidence, gateway },
      revalidatePaths: EVIDENCE_REVALIDATE_PATHS,
      spanAttributes,
    };
  });
}
