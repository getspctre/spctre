import { evaluateGatewayDecision } from "@spctre/policy-schema";
import { GatewayDecisionSchema, parseBody, withTraceId } from "@spctre/api-contracts";
import { getAuthSession } from "@/lib/auth-session";
import {
  hasGatewayCredentialGrantForDecision,
  isGatewayDatabaseConfigured,
  persistGatewayDecisionAndBrokerCredentials,
} from "@/lib/domains/gateway/service";
import { isDemoTenant } from "@/lib/demo-guard";
import { withApiRoute, type ApiRouteContext } from "@/lib/platform/api-route";
import { evidenceIngestUrl, isGatewayEnabled, gatewayMode } from "@/lib/platform/config";
import { fetchWithRetry } from "@/lib/platform/fetch-retry";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { recordDuration } from "@spctre/platform/metrics";
import { getPublishedBlueprintForGateway } from "@/lib/repositories/agent-blueprints";
import { countGatewaySessionDecisions } from "@/lib/repositories/gateway/decisions";
import { resolveCanonicalAgentId } from "@/lib/repositories/identity";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const handlePostApiGatewayDecide = withApiRoute("/api/gateway/decide", async (request, ctx) => {
  const started = Date.now();
  const delegated = await delegateToGoGateway(request, ctx.traceId);
  if (delegated) return delegated;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ctx.error(400, "Request body must be an object.");
  }

  const parsed = parseBody(GatewayDecisionSchema, body);
  if (!parsed.ok) {
    return ctx.error(400, parsed.error, { issues: parsed.issues });
  }

  const auth = await resolveGatewayAuth(request);
  if (!auth.ok) {
    return ctx.error(auth.status, auth.error);
  }

  if (parsed.value.agentId) {
    parsed.value.agentId = await resolveCanonicalAgentId({
      tenantId: auth.tenantId, workspaceId: auth.workspaceId, agentId: parsed.value.agentId,
    });
  }

  const blueprint = parsed.value.agentId && parsed.value.connector && parsed.value.action
    ? await getPublishedBlueprintForGateway({ tenantId: auth.tenantId, workspaceId: auth.workspaceId, agentId: parsed.value.agentId, policyRevisionIds: parsed.value.policyContext.map((context) => context.revisionId) })
    : null;
  const toolRef = parsed.value.connector && parsed.value.action ? `${parsed.value.connector}.${parsed.value.action}` : "";
  const violatesBlueprint = blueprint && parsed.value.connector && parsed.value.action &&
    (!blueprint.definition.connectors.includes(parsed.value.connector) ||
      !blueprint.definition.tools.some((tool) => tool === parsed.value.action || tool === toolRef));
  const gatewayEnabled = isGatewayEnabled();
  let decisionResult = gatewayEnabled
    ? evaluateGatewayDecision(parsed.value)
    : {
        outcome: "PROCEED" as const,
        reason: "Gateway disabled; proceeding by configuration.",
        riskLevel: "LOW" as const,
        shouldQueue: false,
        slaHours: undefined,
      };
  if (violatesBlueprint) decisionResult = { outcome: "ABORT", reason: `Action ${toolRef} is outside the published Blueprint operating envelope.`, riskLevel: "HIGH", shouldQueue: false, slaHours: undefined };
  if (gatewayEnabled && decisionResult.outcome === "PROCEED" && blueprint && parsed.value.agentId && parsed.value.sessionId) {
    const budgets = blueprint.definition.budgets;
    if (budgets?.maxTokensPerTurn !== undefined && parsed.value.contextBudget !== undefined && parsed.value.contextBudget > budgets.maxTokensPerTurn) {
      decisionResult = { outcome: "ESCALATE", reason: `Gateway escalated action: context budget ${parsed.value.contextBudget} exceeds published Blueprint limit ${budgets.maxTokensPerTurn}.`, riskLevel: "HIGH", shouldQueue: true, slaHours: 4 };
    } else if (budgets?.maxToolCallsPerSession !== undefined) {
      const prior = await countGatewaySessionDecisions({ tenantId: auth.tenantId, workspaceId: auth.workspaceId, agentId: parsed.value.agentId, sessionId: parsed.value.sessionId });
      if (prior >= budgets.maxToolCallsPerSession) decisionResult = { outcome: "ABORT", reason: `Gateway aborted action: session has reached published Blueprint tool-call limit ${budgets.maxToolCallsPerSession}.`, riskLevel: "HIGH", shouldQueue: false, slaHours: undefined };
    }
  }

  const isDemo = isDemoTenant(auth.tenantId);
  const shouldPersist = isGatewayDatabaseConfigured() && gatewayEnabled && !isDemo;

  let credentialGrant: unknown = undefined;
  let actionReceipt: unknown = undefined;
  if (shouldPersist) {
    const persistOutcome = await persistDecisionWithReplayGuard(ctx, parsed.value, decisionResult, auth, gatewayEnabled);
    if (persistOutcome instanceof Response) return persistOutcome;
    credentialGrant = persistOutcome.credentialGrant;
    actionReceipt = persistOutcome.receipt;
  }

  const decision = {
    ...decisionResult,
    credentialGrant,
  };

  ctx.span.setAttributes({
    "spctre.gateway.enabled": gatewayEnabled,
    "spctre.gateway.outcome": decision.outcome,
    "spctre.gateway.risk_level": decision.riskLevel,
  });
  recordDuration("spctre.gateway.decide.duration", Date.now() - started, {
    outcome: decision.outcome,
    queued: Boolean(gatewayEnabled && decisionResult.shouldQueue),
  });
  return ctx.json({
    gatewayEnabled,
    mode: gatewayMode(),
    persisted: shouldPersist,
    queued: Boolean(gatewayEnabled && decisionResult.shouldQueue && !isDemo),
    decision,
    actionReceipt,
  });
});

type GatewayDecisionResult = ReturnType<typeof evaluateGatewayDecision>;
type GatewayPersistInput = Parameters<typeof persistGatewayDecisionAndBrokerCredentials>[0]["input"];

// Replay-guard then persist + broker credentials. Returns a terminal Response
// for replayed or failed decisions; otherwise the brokered credential grant.
// May upgrade decisionResult's outcome/reason in place (e.g. ABORT downgrade).
async function persistDecisionWithReplayGuard(
  ctx: ApiRouteContext,
  input: GatewayPersistInput,
  decisionResult: GatewayDecisionResult,
  auth: { tenantId: string; workspaceId: string; actorId: string },
  gatewayEnabled: boolean
): Promise<Response | { credentialGrant: unknown; receipt?: unknown }> {
  const alreadyIssued = await hasGatewayCredentialGrantForDecision({
    decisionId: input.decisionId,
    tenantId: auth.tenantId,
  });
  if (alreadyIssued) {
    return ctx.json({
      gatewayEnabled,
      mode: gatewayMode(),
      persisted: false,
      queued: false,
      decision: {
        outcome: "ABORT" as const,
        reason: "Credential grant already issued for this decision.",
        riskLevel: "CRITICAL" as const,
        shouldQueue: false,
        slaHours: undefined,
        credentialGrant: undefined,
      },
    });
  }

  try {
    const persistenceResult = await persistGatewayDecisionAndBrokerCredentials({
      input,
      decisionResult,
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      actorId: auth.actorId,
    });
    if (!persistenceResult.ok) {
      console.error("[gateway/decide] CRITICAL: brokering failed AND could not persist ABORT to gateway_decision row");
      return ctx.error(503, persistenceResult.error, {
        gatewayEnabled,
        persisted: persistenceResult.persisted,
        queued: false,
        decision: {
          ...decisionResult,
          outcome: "ABORT",
          reason: "Credential brokering failed - persistence unavailable.",
          credentialGrant: undefined,
        },
      });
    }
    if (persistenceResult.outcome) {
      decisionResult.outcome = persistenceResult.outcome;
      decisionResult.reason = persistenceResult.reason ?? decisionResult.reason;
    }
    return { credentialGrant: persistenceResult.credentialGrant || undefined, receipt: persistenceResult.receipt };
  } catch (err) {
    console.error("[gateway/decide] failed to persist gateway decision:", err);
    return ctx.error(503, "Gateway decision could not be persisted.", {
      gatewayEnabled,
      persisted: false,
      queued: false,
      decision: {
        ...decisionResult,
        credentialGrant: undefined,
      },
    });
  }
}

async function delegateToGoGateway(request: Request, traceId: string): Promise<Response | null> {
  const baseUrl = evidenceIngestUrl();
  if (!baseUrl || request.headers.get("x-spctre-forwarded-by") === "web" || !hasBearerToken(request)) {
    return null;
  }

  const target = new URL("/api/gateway/decide", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers = new Headers(request.headers);
  headers.set("x-request-id", traceId);
  headers.set("x-spctre-forwarded-by", "web");
  headers.delete("host");
  headers.delete("content-length");

  // Retry-safe: gateway decisions upsert on (tenant_id, decision_id).
  const response = await fetchWithRetry(target, {
    method: "POST",
    headers,
    body: await request.text(),
    cache: "no-store",
    timeoutMs: 15_000,
  });

  return withTraceId(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    traceId
  );
}

async function resolveGatewayAuth(request: Request): Promise<
  | { ok: true; tenantId: string; workspaceId: string; actorId: string }
  | { ok: false; error: string; status: number }
> {
  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "evidence:write");
    if (!tokenAuth.ok) {
      return { ok: false, error: "Invalid or expired service token.", status: 401 };
    }
    const { tenantId, workspaceId, principalId: actorId } = tokenAuth.auth;
    if (!tenantId || !workspaceId) {
      return { ok: false, error: "Workspace context unavailable.", status: 400 };
    }
    return { ok: true, tenantId, workspaceId, actorId };
  }

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { ok: false, error: "Authentication required.", status: 401 };

  const workspaceContext = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!workspaceContext) {
    return { ok: false, error: "Workspace context unavailable.", status: 400 };
  }

  return {
    ok: true,
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    actorId: session.principalId,
  };
}

export { handlePostApiGatewayDecide as POST };
