import { getActiveActor } from "@/lib/actors";
import { evidenceIngestUrl, workerInternalSecret } from "@/lib/platform/config";
import { runWithTenantContext } from "@/lib/tenant-context";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import type { ActiveScope } from "@/lib/workspace";
import type { GatewayDecisionInput, SignedActionReceipt } from "@spctre/policy-schema";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { persistActionReceipt } from "@/lib/repositories/action-receipts";
import { issueGatewayActionReceipt } from "@/lib/domains/gateway/receipts";
import {
  assignEscalationQueueItem,
  brokerCredential,
  findCredentialBroker,
  getEscalationStatusByDecisionId,
  getOpenEscalationQueueItem,
  getResolvedEscalationReceiptContext,
  hasCredentialGrantBeenIssued,
  hasCredentialGrantBeenIssuedByDecisionId,
  persistGatewayDecision,
  resolveEscalationQueueItem,
  listOpenEscalationQueue,
  updateEscalationOutcome,
  updateGatewayDecisionOutcome,
} from "@/lib/repositories/gateway";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import { ensureAuthDemoTenant, resolveTenantIdOrDemo, resolveWorkspaceIdOrDemo } from "@/lib/repositories/auth/session";
import { ingestNormalizedGatewayEvent, type GatewayEventV1 } from "@/lib/domains/gateway/ingest";

export function isGatewayDatabaseConfigured(): boolean {
  return isDatabaseConfigured();
}

export function getTenantIdOrDemo(header: string | null): string {
  return resolveTenantIdOrDemo(header);
}

export function getWorkspaceIdOrDemo(header: string | null): string | null {
  return resolveWorkspaceIdOrDemo(header);
}

export async function ingestGatewayEvent(params: {
  event: GatewayEventV1;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  environment: string;
}) {
  await ensureAuthDemoTenant();
  return runWithTenantContext(params.tenantId, () =>
    ingestNormalizedGatewayEvent(
      params.event,
      params.tenantId,
      params.workspaceId,
      params.principalId,
      params.environment
    )
  );
}

export type OpenEscalationQueue = Awaited<ReturnType<typeof listOpenEscalationQueue>>;

export async function listGatewayEscalationQueue(params: {
  workspaceId: string;
  tenantId: string;
  limit: number;
}): Promise<OpenEscalationQueue> {
  return runWithTenantContext(params.tenantId, () =>
    listOpenEscalationQueue(params.workspaceId, params.tenantId, params.limit)
  );
}

export async function resolveGatewayEscalation(params: {
  queueId: string;
  tenantId: string;
  workspaceId: string;
  reviewedBy: string;
  resolutionOutcome: "PROCEED" | "ESCALATE" | "ABORT";
  resolutionNote?: string;
  agentGuidance?: string;
}): Promise<boolean> {
  return runWithTenantContext(params.tenantId, async () => {
    const resolved = await resolveEscalationQueueItem(params);
    if (!resolved || params.resolutionOutcome === "ESCALATE") return resolved;
    const context = await getResolvedEscalationReceiptContext(params).catch(() => null);
    if (!context || !["HIGH", "CRITICAL"].includes(context.riskLevel)) return resolved;
    const receipt = issueGatewayActionReceipt({
      decisionId: context.decisionId,
      branchId: context.branchId ?? undefined,
      revisionId: context.revisionId ?? undefined,
      artifactHash: context.artifactHash,
      connector: context.connector ?? undefined,
      action: context.action ?? undefined,
      outcome: params.resolutionOutcome,
      actorId: context.actorId,
      reviewerId: params.reviewedBy,
    });
    if (!receipt) return resolved;
    const persisted = await persistActionReceipt({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      gatewayDecisionId: context.gatewayDecisionId,
      stage: "RESOLUTION",
      receipt,
    }).catch(() => null);
    if (persisted) {
      appendOperationsLog({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        eventType: "ACTION_RECEIPT_ISSUED",
        sourceId: persisted.payload.receiptId,
        sourceTable: "action_receipt",
        actorId: params.reviewedBy,
        payload: { decisionId: context.decisionId, revisionId: context.revisionId, artifactHash: context.artifactHash, outcome: params.resolutionOutcome, reviewerId: params.reviewedBy, keyId: persisted.signature.keyId, payloadHash: persisted.signature.payloadHash },
      }).catch(() => {});
    }
    return resolved;
  });
}

export async function getGatewayEscalationStatus(params: {
  decisionId: string;
  tenantId: string;
  workspaceId: string;
}) {
  return runWithTenantContext(params.tenantId, () => getGatewayEscalationStatusInTenant(params));
}

async function getGatewayEscalationStatusInTenant(params: {
  decisionId: string;
  tenantId: string;
  workspaceId: string;
}) {
  const status = await getEscalationStatusByDecisionId(
    params.decisionId,
    params.tenantId,
    params.workspaceId
  );
  if (
    status &&
    status.status === "RESOLVED" &&
    status.resolutionOutcome === "PROCEED" &&
    status.connector &&
    status.action
  ) {
    const alreadyIssued = await hasCredentialGrantBeenIssued(status.gatewayDecisionId, params.tenantId);
    if (alreadyIssued) {
      status.resolutionOutcome = "ABORT";
      status.resolutionNote = "Credential already issued by a concurrent request.";
      status.credentialGrant = undefined;
    } else {
      const broker = await findCredentialBroker({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        connector: status.connector,
        action: status.action,
      });
      if (broker) {
        const brokerResult = await brokerCredential(broker, {
          tenantId: params.tenantId,
          workspaceId: params.workspaceId,
          gatewayDecisionId: status.gatewayDecisionId,
        });
        if (brokerResult.status === "granted") {
          status.credentialGrant = brokerResult.grant;
        } else if (brokerResult.status === "already_issued") {
          status.resolutionOutcome = "ABORT";
          status.resolutionNote = "Credential already issued by a concurrent request.";
          status.credentialGrant = undefined;
        } else if (brokerResult.status === "error") {
          const persisted = await updateEscalationOutcome({
            gatewayDecisionId: status.gatewayDecisionId,
            tenantId: params.tenantId,
            workspaceId: params.workspaceId,
            resolutionOutcome: "ABORT",
            resolutionNote: "Credential brokering failed.",
          });
          if (!persisted) {
            return {
              error: "Credential brokering failed and the decision record could not be updated. Retry later.",
            };
          }
          status.resolutionOutcome = "ABORT";
          status.resolutionNote = "Credential brokering failed.";
        }
      }
    }
  }

  if (!status) return { status: null };

  // The persisted parameters are an immutable, redacted/bounded snapshot of
  // the decision. They become a cross-machine handoff only after a human has
  // resolved this exact escalation to PROCEED. Never expose them for pending,
  // expired, or denied escalation states.
  const { toolParameters, ...publicStatus } = status;
  if (
    publicStatus.status === "RESOLVED" &&
    publicStatus.resolutionOutcome === "PROCEED" &&
    toolParameters
  ) {
    return { status: { ...publicStatus, approvedToolParameters: toolParameters } };
  }
  return { status: publicStatus };
}

export async function hasGatewayCredentialGrantForDecision(params: {
  decisionId: string;
  tenantId: string;
}): Promise<boolean> {
  return runWithTenantContext(params.tenantId, () =>
    hasCredentialGrantBeenIssuedByDecisionId(params.decisionId, params.tenantId)
  );
}

export async function persistGatewayDecisionAndBrokerCredentials(params: {
  input: GatewayDecisionInput & { connector?: string; action?: string };
  decisionResult: {
    outcome: "PROCEED" | "ESCALATE" | "ABORT";
    reason: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    shouldQueue: boolean;
    slaHours?: number;
  };
  tenantId: string;
  workspaceId: string;
  actorId: string;
}): Promise<
  | { ok: true; credentialGrant?: unknown; outcome?: "ABORT"; reason?: string; receipt?: SignedActionReceipt }
  | { ok: false; error: string; persisted: boolean }
> {
  return runWithTenantContext(params.tenantId, () =>
    persistGatewayDecisionAndBrokerCredentialsInTenant(params)
  );
}

async function persistGatewayDecisionAndBrokerCredentialsInTenant(
  params: Parameters<typeof persistGatewayDecisionAndBrokerCredentials>[0]
): Promise<
  | { ok: true; credentialGrant?: unknown; outcome?: "ABORT"; reason?: string; receipt?: SignedActionReceipt }
  | { ok: false; error: string; persisted: boolean }
> {
  const firstContext = params.input.policyContext[0];
  const gatewayDecisionId = await persistGatewayDecision({
    decisionId: params.input.decisionId,
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    firstContext,
    artifactHash: params.input.artifactHash,
    outcome: params.decisionResult.outcome,
    reason: params.decisionResult.reason,
    consequence: params.input.consequence,
    customerTier: params.input.customerTier,
    confidence: params.input.confidence,
    amountUsd: params.input.amountUsd,
    dataSensitivity: params.input.dataSensitivity,
    trustScore: params.input.trustScore,
    contextBudget: params.input.contextBudget,
    riskLevel: params.decisionResult.riskLevel,
    evaluatedBy: params.actorId,
    agentId: params.input.agentId,
    sessionId: params.input.sessionId,
    shouldQueue: params.decisionResult.shouldQueue,
    slaHours: params.decisionResult.slaHours,
    toolIntent: params.input.toolIntent,
    planSummary: params.input.planSummary,
    toolParameters: params.input.toolParameters,
  });

  const issueReceipt = async (outcome: "PROCEED" | "ESCALATE" | "ABORT") => {
    if (!gatewayDecisionId || outcome === "ESCALATE" || !["HIGH", "CRITICAL"].includes(params.decisionResult.riskLevel)) return undefined;
    const signed = issueGatewayActionReceipt({
      decisionId: params.input.decisionId,
      branchId: firstContext?.branchId,
      revisionId: firstContext?.revisionId,
      artifactHash: params.input.artifactHash,
      agentId: params.input.agentId,
      connector: params.input.connector,
      action: params.input.action,
      outcome,
      actorId: params.actorId,
    });
    if (!signed) return undefined;
    const persisted = await persistActionReceipt({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      gatewayDecisionId,
      receipt: signed,
    }).catch(() => null);
    if (persisted) {
      appendOperationsLog({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        eventType: "ACTION_RECEIPT_ISSUED",
        sourceId: persisted.payload.receiptId,
        sourceTable: "action_receipt",
        actorId: params.actorId,
        payload: {
          decisionId: persisted.payload.decisionId,
          revisionId: persisted.payload.revisionId,
          artifactHash: persisted.payload.artifactHash,
          outcome: persisted.payload.outcome,
          keyId: persisted.signature.keyId,
          payloadHash: persisted.signature.payloadHash,
        },
      }).catch(() => {});
    }
    return persisted ?? undefined;
  };

  if (
    !gatewayDecisionId ||
    params.decisionResult.outcome !== "PROCEED" ||
    !params.input.connector ||
    !params.input.action
  ) {
    return { ok: true, receipt: await issueReceipt(params.decisionResult.outcome) };
  }

  const broker = await findCredentialBroker({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    connector: params.input.connector,
    action: params.input.action,
  });
  if (!broker) return { ok: true, receipt: await issueReceipt("PROCEED") };

  const brokerResult = await brokerCredential(broker, {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    gatewayDecisionId,
  });
  if (brokerResult.status === "granted") {
    return { ok: true, credentialGrant: brokerResult.grant, receipt: await issueReceipt("PROCEED") };
  }
  if (brokerResult.status === "already_issued") {
    return { ok: true, outcome: "ABORT", reason: "Credential already issued by a concurrent request.", receipt: await issueReceipt("ABORT") };
  }
  if (brokerResult.status === "error") {
    const persisted = await updateGatewayDecisionOutcome(
      gatewayDecisionId,
      params.tenantId,
      "ABORT",
      "Credential brokering failed."
    );
    if (!persisted) {
      return {
        ok: false,
        persisted: true,
        error: "Credential brokering failed and the decision record could not be updated. Retry later.",
      };
    }
    return { ok: true, outcome: "ABORT", reason: "Credential brokering failed.", receipt: await issueReceipt("ABORT") };
  }

  return { ok: true, receipt: await issueReceipt(params.decisionResult.outcome) };
}

export type ResolveEscalationResult = { error: string } | { ok: true };

type GatewayWorkerMutation = "claim" | "resolve";

async function delegateGatewayMutationToWorker(params: {
  mutation: GatewayWorkerMutation;
  tenantId: string;
  workspaceId: string;
  actorId: string;
  body: Record<string, unknown>;
}): Promise<ResolveEscalationResult | ClaimEscalationResult | undefined> {
  const baseUrl = evidenceIngestUrl();
  const secret = workerInternalSecret();
  if (!baseUrl || !secret) return undefined;

  const target = new URL(`/api/gateway/${params.mutation}`, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetchWithTimeout(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spctre-internal-secret": secret,
      "x-spctre-tenant-id": params.tenantId,
      "x-spctre-workspace-id": params.workspaceId,
      "x-spctre-actor-id": params.actorId,
    },
    body: JSON.stringify(params.body),
    cache: "no-store",
    timeoutMs: 15_000,
  }).catch((error) => ({ ok: false, status: 503, json: async () => ({ error: String(error) }) } as Response));

  if (response.ok) return { ok: true };

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return { error: payload?.error ?? `Gateway worker mutation failed with status ${response.status}.` };
}

export async function resolveEscalationDecision(input: {
  queueId: string;
  resolutionOutcome: string;
  resolutionNote?: string;
  agentGuidance?: string;
}, scope: ActiveScope | null): Promise<ResolveEscalationResult> {
  const workspaceContext = scope;
  if (!workspaceContext) return { error: "Workspace context unavailable." };
  return runWithTenantContext(workspaceContext.tenantId, async () => {

  const { actor } = await getActiveActor({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId,
  }).catch(() => ({ actor: null }));
  if (!actor) return { error: "Authentication required." };

  if (!input.queueId) return { error: "Queue item ID is required." };
  if (
    input.resolutionOutcome !== "PROCEED" &&
    input.resolutionOutcome !== "ESCALATE" &&
    input.resolutionOutcome !== "ABORT"
  ) {
    return { error: "Resolution outcome must be PROCEED, ESCALATE, or ABORT." };
  }

  const delegated = await delegateGatewayMutationToWorker({
    mutation: "resolve",
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    actorId: actor.id,
    body: {
      queueId: input.queueId,
      resolutionOutcome: input.resolutionOutcome,
      resolutionNote: input.resolutionNote,
      agentGuidance: input.agentGuidance,
    },
  });
  if (delegated) return delegated;

  const ok = await resolveEscalationQueueItem({
    queueId: input.queueId,
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    reviewedBy: actor.id,
    resolutionOutcome: input.resolutionOutcome,
    resolutionNote: input.resolutionNote,
    agentGuidance: input.agentGuidance,
  });

  if (!ok) return { error: "Escalation item not found or already resolved." };

  appendOperationsLog({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    eventType: "ESCALATION_RESOLVED",
    sourceId: input.queueId,
    sourceTable: "gateway_escalation_queue",
    actorId: actor.id,
    payload: {
      queueId: input.queueId,
      resolutionOutcome: input.resolutionOutcome,
      resolutionNote: input.resolutionNote,
      agentGuidance: input.agentGuidance,
    },
  }).catch(() => {});

  return { ok: true };
  });
}

export type ClaimEscalationResult = { error: string } | { ok: true };

export async function claimEscalationDecision(input: {
  queueId: string;
}, scope: ActiveScope | null): Promise<ClaimEscalationResult> {
  const workspaceContext = scope;
  if (!workspaceContext) return { error: "Workspace context unavailable." };
  return runWithTenantContext(workspaceContext.tenantId, async () => {

  const { actor } = await getActiveActor({
    workspaceId: workspaceContext.workspaceId,
    tenantId: workspaceContext.tenantId,
  }).catch(() => ({ actor: null }));
  if (!actor) return { error: "Authentication required." };

  if (!input.queueId) return { error: "Queue item ID is required." };

  const delegated = await delegateGatewayMutationToWorker({
    mutation: "claim",
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    actorId: actor.id,
    body: { queueId: input.queueId },
  });
  if (delegated) return delegated;

  const ok = await assignEscalationQueueItem({
    queueId: input.queueId,
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    assignedTo: actor.id,
  });

  if (!ok) return { error: "Escalation item not found, already assigned, or already resolved." };

  appendOperationsLog({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    eventType: "ESCALATION_RESOLVED",
    sourceId: input.queueId,
    sourceTable: "gateway_escalation_queue",
    actorId: actor.id,
    payload: { queueId: input.queueId, action: "CLAIMED", assignedTo: actor.id },
  }).catch(() => {});

  return { ok: true };
  });
}
