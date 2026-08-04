import { ingestAgtRuntimeDecision } from "@spctre/policy-schema";
import type { RuntimePolicyContext } from "@spctre/policy-schema";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { resolveRevisionAtTime } from "@/lib/repositories/gateway";
import { insertGatewayEvidenceEvent } from "@/lib/repositories/evidence";
import type { RevisionAtTime } from "@/lib/repositories/gateway";

import { logger } from "@spctre/platform/logging";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { swallow } from "@/lib/platform/swallow";

export type GatewayProvider = "portkey" | "helicone" | "litellm" | "notion";

export interface GatewayEventV1 {
  provider: GatewayProvider;
  gatewayEventId: string;
  model: string;
  agentId: string;
  connector: string;
  action: string;
  toolDeclarations: string[];
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number | undefined;
  eventTimestamp: string;
  rawEvent: Record<string, unknown>;
}

/**
 * Constructs a RuntimePolicyContext from a resolved revision, suitable for
 * evidence records created via the gateway ingest path.
 */
function buildGatewayPolicyContext(revision: RevisionAtTime): RuntimePolicyContext {
  return {
    scope: revision.scope as RuntimePolicyContext["scope"],
    branchId: revision.branchId,
    revisionId: revision.revisionId,
    artifactHash: revision.artifactHash,
  };
}

// Heuristic mappings from common tool name fragments to Spctre connector ids.
const CONNECTOR_FRAGMENTS: Array<{ pattern: RegExp; connector: string }> = [
  { pattern: /github/i, connector: "github" },
  { pattern: /gitlab/i, connector: "gitlab" },
  { pattern: /jira/i, connector: "jira" },
  { pattern: /linear/i, connector: "linear" },
  { pattern: /slack/i, connector: "slack" },
  { pattern: /notion/i, connector: "notion" },
  { pattern: /stripe/i, connector: "stripe" },
  { pattern: /postgres|postgresql|pg_/i, connector: "postgresql" },
  { pattern: /mongo/i, connector: "mongodb" },
  { pattern: /redis/i, connector: "redis" },
  { pattern: /s3|aws_s3/i, connector: "aws-s3" },
  { pattern: /lambda/i, connector: "aws-lambda" },
  { pattern: /kubernetes|kubectl|k8s/i, connector: "kubernetes" },
  { pattern: /snowflake/i, connector: "snowflake" },
  { pattern: /bigquery/i, connector: "bigquery" },
  { pattern: /sendgrid/i, connector: "sendgrid" },
  { pattern: /hubspot/i, connector: "hubspot" },
  { pattern: /salesforce/i, connector: "salesforce" },
  { pattern: /zendesk/i, connector: "zendesk" },
  { pattern: /intercom/i, connector: "intercom" },
  { pattern: /pagerduty/i, connector: "pagerduty" },
  { pattern: /datadog/i, connector: "datadog" },
  { pattern: /sentry/i, connector: "sentry" },
];

/**
 * Attempts to infer a Spctre connector and action from a list of tool names
 * declared in an LLM gateway event. Returns the best match, or "llm-gateway"
 * as the fallback connector when no match is found.
 */
function mapToolsToConnector(toolNames: string[]): {
  connector: string;
  action: string;
  provenanceGap: boolean;
} {
  for (const tool of toolNames) {
    for (const { pattern, connector } of CONNECTOR_FRAGMENTS) {
      if (pattern.test(tool)) {
        const action = tool
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .replace(/_+/g, "_");
        return { connector, action, provenanceGap: false };
      }
    }
  }

  // No connector match — fall back to a generic llm-gateway connector
  const primaryTool = toolNames[0];
  const action = primaryTool
    ? primaryTool
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
    : "llm_call";
  return { connector: "llm-gateway", action, provenanceGap: true };
}

// ─── Provider-specific normalizers ───────────────────────────────────────────

/**
 * Normalizes a raw Portkey webhook payload to GatewayEventV1.
 * Portkey sends: { event, id, model, request: { tools }, response: { usage },
 *                  metadata: { agentId, environment }, latency, cost, timestamp }
 */
export function normalizePortkeyEvent(raw: Record<string, unknown>): GatewayEventV1 | null {
  const id = stringField(raw, "id");
  if (!id) return null;

  const request = objectField(raw, "request");
  const response = objectField(raw, "response");
  const metadata = objectField(raw, "metadata");
  const usage = response ? objectField(response, "usage") : null;

  const toolDeclarations = extractToolNames(request?.tools);
  const { connector, action } = mapToolsToConnector(toolDeclarations);

  const timestamp =
    stringField(raw, "timestamp") ?? stringField(raw, "created_at") ?? new Date().toISOString();

  return {
    provider: "portkey",
    gatewayEventId: id,
    model: stringField(raw, "model") ?? "unknown",
    agentId: stringField(metadata, "agentId") ?? stringField(raw, "virtual_key") ?? "gateway-agent",
    connector,
    action,
    toolDeclarations,
    promptTokens: numberField(usage, "prompt_tokens") ?? 0,
    completionTokens: numberField(usage, "completion_tokens") ?? 0,
    latencyMs: numberField(raw, "latency") ?? 0,
    costUsd: numberField(raw, "cost") ?? undefined,
    eventTimestamp: timestamp,
    rawEvent: raw,
  };
}

/**
 * Normalizes a raw Helicone webhook payload to GatewayEventV1.
 * Helicone sends: { event, data: { id, model, provider, request, response,
 *                   properties, latency, cost: { total }, created_at } }
 */
export function normalizeHeliconeEvent(raw: Record<string, unknown>): GatewayEventV1 | null {
  const data = objectField(raw, "data") ?? raw;
  const id = stringField(data, "id");
  if (!id) return null;

  const request = objectField(data, "request");
  const response = objectField(data, "response");
  const properties = objectField(data, "properties");
  const cost = objectField(data, "cost");
  const usage =
    (response ? objectField(response, "usage") : null) ??
    (response ? objectField(response as Record<string, unknown>, "body") : null);

  const toolDeclarations = extractToolNames(request?.tools);
  const { connector, action } = mapToolsToConnector(toolDeclarations);

  const timestamp =
    stringField(data, "created_at") ?? stringField(raw, "created_at") ?? new Date().toISOString();

  return {
    provider: "helicone",
    gatewayEventId: id,
    model: stringField(data, "model") ?? "unknown",
    agentId:
      stringField(properties, "agentId") ??
      stringField(properties, "Helicone-Session-Id") ??
      "gateway-agent",
    connector,
    action,
    toolDeclarations,
    promptTokens: numberField(usage, "prompt_tokens") ?? 0,
    completionTokens: numberField(usage, "completion_tokens") ?? 0,
    latencyMs: numberField(data, "latency") ?? 0,
    costUsd: numberField(cost, "total") ?? undefined,
    eventTimestamp: timestamp,
    rawEvent: raw,
  };
}

/**
 * Normalizes a raw LiteLLM webhook payload to GatewayEventV1.
 * LiteLLM sends: { event_type, id, model, messages, response, usage,
 *                  metadata: { user_api_key_alias, tags, spend },
 *                  startTime, endTime }
 */
export function normalizeLitellmEvent(raw: Record<string, unknown>): GatewayEventV1 | null {
  const id = stringField(raw, "id") ?? stringField(raw, "call_id");
  if (!id) return null;

  const metadata = objectField(raw, "metadata");
  const usage = objectField(raw, "usage");
  const messages = raw.messages;
  const toolDeclarations = extractToolNames(
    Array.isArray(messages)
      ? (messages as Record<string, unknown>[]).flatMap((m) =>
          Array.isArray((m as Record<string, unknown>).tool_calls)
            ? ((m as Record<string, unknown>).tool_calls as Record<string, unknown>[])
            : [],
        )
      : undefined,
  );
  const { connector, action } = mapToolsToConnector(toolDeclarations);

  const startMs = numberField(raw, "startTime");
  const endMs = numberField(raw, "endTime");
  const latencyMs = startMs != null && endMs != null ? Math.round((endMs - startMs) * 1000) : 0;

  const timestamp =
    typeof startMs === "number"
      ? new Date(startMs * 1000).toISOString()
      : (stringField(raw, "created_at") ?? new Date().toISOString());

  return {
    provider: "litellm",
    gatewayEventId: id,
    model: stringField(raw, "model") ?? "unknown",
    agentId:
      stringField(metadata, "user_api_key_alias") ??
      stringField(metadata, "user_api_key") ??
      "gateway-agent",
    connector,
    action,
    toolDeclarations,
    promptTokens: numberField(usage, "prompt_tokens") ?? 0,
    completionTokens: numberField(usage, "completion_tokens") ?? 0,
    latencyMs,
    costUsd: numberField(metadata, "spend") ?? undefined,
    eventTimestamp: timestamp,
    rawEvent: raw,
  };
}

/**
 * Normalizes a raw Notion Worker webhook payload to GatewayEventV1.
 * Notion Workers send: { id, worker_id, execution_id, agent_id, action,
 *                        tools, input, output, model, usage, latency_ms,
 *                        created_at, metadata: { environment } }
 * provenance_gap is always true: Notion does not natively emit AGT evidence.
 */
export function normalizeNotionEvent(raw: Record<string, unknown>): GatewayEventV1 | null {
  const id = stringField(raw, "id") ?? stringField(raw, "execution_id");
  if (!id) return null;

  const metadata = objectField(raw, "metadata");
  const usage = objectField(raw, "usage");
  const tools = raw.tools;
  const toolDeclarations = extractToolNames(Array.isArray(tools) ? tools : []);

  const timestamp =
    stringField(raw, "created_at") ?? stringField(raw, "timestamp") ?? new Date().toISOString();

  return {
    provider: "notion",
    gatewayEventId: id,
    model: stringField(raw, "model") ?? "unknown",
    agentId: stringField(raw, "agent_id") ?? stringField(raw, "worker_id") ?? "gateway-agent",
    connector: "gateway-notion",
    action: stringField(raw, "action") ?? toolDeclarations[0] ?? "worker.execute",
    toolDeclarations,
    promptTokens: numberField(usage, "prompt_tokens") ?? numberField(usage, "input_tokens") ?? 0,
    completionTokens:
      numberField(usage, "completion_tokens") ?? numberField(usage, "output_tokens") ?? 0,
    latencyMs: numberField(raw, "latency_ms") ?? 0,
    costUsd: numberField(raw, "cost_usd") ?? undefined,
    eventTimestamp: timestamp,
    rawEvent: raw,
  };
}

// ─── DB Ingest ───────────────────────────────────────────────────────────────

export interface GatewayIngestResult {
  decisionId: string;
  provenanceGap: boolean;
  deduplicated: boolean;
}

/**
 * Inserts a normalized gateway event as a runtime_evidence_event row.
 *
 * Performs revision-at-time lookup to resolve policy context. If no published
 * revision is found at event time, the record is stored with provenance_gap: true
 * in rawEvidence and status coerced to WARN. Idempotent on decision_id.
 */
export async function ingestNormalizedGatewayEvent(
  event: GatewayEventV1,
  tenantId: string,
  workspaceId: string,
  principalId: string,
  environment: string,
): Promise<GatewayIngestResult> {
  const started = Date.now();

  const revision = await resolveRevisionAtTime(tenantId, workspaceId, event.eventTimestamp);
  const provenanceGap =
    revision === null ||
    (event.toolDeclarations.length > 0 &&
      mapToolsToConnector(event.toolDeclarations).provenanceGap);
  const policyContext: RuntimePolicyContext[] = revision
    ? [buildGatewayPolicyContext(revision)]
    : [];

  const artifactHash = revision?.artifactHash ?? "gateway-unresolved";
  const policyRefs = revision ? [`gateway.${event.provider}.ingest`] : ["gateway.provenance-gap"];

  const status = provenanceGap ? "WARN" : "ALLOW";
  const reason = provenanceGap
    ? `Gateway event received from ${event.provider}; policy context could not be fully resolved at event time.`
    : `Gateway event received from ${event.provider}; policy context resolved from published revision at event time.`;

  const decisionId = `gw-${event.provider}-${event.gatewayEventId}`;

  const rawEvidenceWithMeta: Record<string, unknown> = {
    ...event.rawEvent,
    _source: "gateway",
    _gateway_provider: event.provider,
    _gateway_event_id: event.gatewayEventId,
    _provenance_gap: provenanceGap,
    _model: event.model,
    _tool_declarations: event.toolDeclarations,
    _prompt_tokens: event.promptTokens,
    _completion_tokens: event.completionTokens,
    _cost_usd: event.costUsd,
  };

  const agtInput = ingestAgtRuntimeDecision({
    decisionId,
    tenantId,
    workspaceId,
    environment,
    runtimeTarget: { stack: "CUSTOM", adapter: `gateway-${event.provider}` },
    agentId: event.agentId,
    connector: event.connector,
    action: event.action,
    status,
    reason,
    policyRefs,
    artifactHash,
    policyContext,
    latencyMs: event.latencyMs,
    createdAt: event.eventTimestamp,
    rawEvidence: rawEvidenceWithMeta,
  });

  const { deduplicated } = await insertGatewayEvidenceEvent({
    tenantId,
    workspaceId,
    decisionId: agtInput.decisionId,
    environment: agtInput.environment,
    runtimeStack: agtInput.runtimeTarget.stack,
    runtimeAdapter: agtInput.runtimeTarget.adapter ?? null,
    agentId: agtInput.agentId,
    connector: agtInput.connector,
    action: agtInput.action,
    status: agtInput.status,
    reason: agtInput.reason,
    policyRefs: agtInput.policyRefs,
    artifactHash: agtInput.artifactHash,
    policyContext: agtInput.policyContext,
    rawEvidence: rawEvidenceWithMeta,
    latencyMs: agtInput.latencyMs,
    createdAt: agtInput.createdAt,
  });

  if (!deduplicated) {
    appendOperationsLog({
      tenantId,
      workspaceId,
      eventType: "EVIDENCE_INGEST",
      sourceId: decisionId,
      sourceTable: "runtime_evidence_event",
      actorId: principalId,
      payload: {
        agentId: event.agentId,
        connector: event.connector,
        action: event.action,
        status,
        artifactHash,
        runtimeStack: "CUSTOM",
        gatewayProvider: event.provider,
        provenanceGap,
      },
    }).catch(swallow("appendOperationsLog", undefined));
  }

  const outcome = deduplicated ? "deduplicated" : "created";
  incrementCounter("spctre.evidence.ingested", 1, {
    source: "gateway",
    provider: event.provider,
    status,
    outcome,
  });
  recordDuration("spctre.evidence.ingest.duration", Date.now() - started, {
    source: "gateway",
    outcome,
  });

  if (provenanceGap) {
    logger.warn("Gateway event stored with provenance gap", {
      provider: event.provider,
      gatewayEventId: event.gatewayEventId,
      tenantId,
      workspaceId,
    });
  }

  return { decisionId, provenanceGap, deduplicated };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stringField(
  obj: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!obj) return undefined;
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function numberField(
  obj: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  if (!obj) return undefined;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function objectField(
  obj: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!obj) return null;
  const v = obj[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function extractToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const t = tool as Record<string, unknown>;
    // OpenAI-style: { type: "function", function: { name } }
    const fn = t.function as Record<string, unknown> | undefined;
    if (fn && typeof fn.name === "string" && fn.name.trim()) {
      names.push(fn.name.trim());
      continue;
    }
    // LiteLLM / Anthropic tool_call style: { type: "tool_use", name }
    if (typeof t.name === "string" && t.name.trim()) {
      names.push(t.name.trim());
      continue;
    }
    // function.name directly
    if (typeof t.function === "string" && t.function.trim()) {
      names.push(t.function.trim());
    }
  }
  return names;
}
