import { z } from "zod";
import { sanitizeText, redactAndBoundParameters } from "./sanitization";

export const RuntimeStackSchema = z.enum([
  "AWS_BEDROCK",
  "GOOGLE_ADK",
  "AZURE_AI",
  "LANGCHAIN",
  "LANGGRAPH",
  "CREWAI",
  "AUTOGEN",
  "OPENAI_AGENTS",
  "OMNIGENT",
  "OPENCODE",
  "CLAUDE_CODE",
  "HERMES",
  "OPENCLAW",
  "NEMOCLAW",
  "CLAUDE_COWORK",
  "ODYSSEUS",
  "PAPERCLIP",
  "LOCAL",
  "CUSTOM",
]);

const RuntimeDecisionStatusSchema = z.enum(["ALLOW", "DENY", "WARN", "ESCALATE"]);

const RuntimeTargetSchema = z.object({
  stack: RuntimeStackSchema,
  adapter: z.string().optional(),
  environment: z.string().optional(),
  sandboxName: z.string().optional(),
  inferenceProvider: z.string().optional(),
});

const RuntimePolicyContextSchema = z.object({
  scope: z.enum(["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR", "COMPANY"]),
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  artifactHash: z.string().min(1),
  packId: z.string().optional(),
  packVersion: z.string().optional(),
  packOwner: z.string().optional(),
});

/**
 * Schema for the evidence ingest wire format (POST /api/evidence).
 *
 * Required fields for a valid evidence record. Optional fields that the server
 * defaults (tenantId, workspaceId, latencyMs, createdAt) are marked optional here
 * so clients can omit them; the route fills in the right values after auth.
 *
 * When ingestMode is "gateway", policyRefs, artifactHash, and policyContext may
 * be omitted — the server performs a revision-at-time lookup using createdAt to
 * resolve the active published policy and fills in the policy context. Records
 * where context cannot be resolved are stored with provenance_gap: true in
 * rawEvidence and coerced to WARN status.
 */
export const EvidenceIngestSchema = z.object({
  decisionId: z.string().min(1, "decisionId is required."),
  tenantId: z.string().optional(),
  workspaceId: z.string().optional(),
  environment: z.string().min(1, "environment is required."),
  runtimeTarget: RuntimeTargetSchema,
  agentId: z.string().min(1, "agentId is required."),
  connector: z.string().min(1, "connector is required."),
  action: z.string().min(1, "action is required."),
  status: RuntimeDecisionStatusSchema,
  reason: z.string().min(1, "reason is required."),
  policyRefs: z.array(z.string()).min(1).optional(),
  artifactHash: z.string().optional(),
  policyContext: z.array(RuntimePolicyContextSchema).min(1).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  rawEvidence: z.record(z.string(), z.unknown()).optional(),
  // Gateway context hints — all optional, forwarded to the gateway evaluator
  consequence: z.string().optional(),
  customerTier: z.string().optional(),
  confidence: z.number().optional(),
  amountUsd: z.number().optional(),
  dataSensitivity: z.string().optional(),
  trustScore: z.number().optional(),
  contextBudget: z.number().int().optional(),
  // Source metadata
  sourceType: z.string().optional(),
  executionTrace: z.unknown().optional(),
  engineVersion: z.string().optional(),
  // Gateway ingest mode — server performs revision-at-time lookup when set
  ingestMode: z.enum(["standard", "gateway"]).optional(),
  // Pre-flight intent fields (Phase 1)
  toolIntent: z.string().max(100000).optional().transform((val) => sanitizeText(val, 1000)),
  planSummary: z.string().max(100000).optional().transform((val) => sanitizeText(val, 2000)),
  toolParameters: z.record(z.string(), z.unknown()).optional().transform((val) => redactAndBoundParameters(val)),
  // Runtime integration landscape fields (Phase 2 — new runtime stacks)
  triggerKind: z.enum(["interactive", "scheduled", "mobile_dispatch", "inbound_webhook", "routine", "gateway_message"]).optional(),
  layer: z.enum(["agent", "sandbox"]).optional(),
  executionContext: z.object({
    backend: z.string().optional(),
    sessionId: z.string().optional(),
    sandboxName: z.string().optional(),
    inferenceProvider: z.string().optional(),
    sandboxPolicyRef: z.string().optional(),
    inferenceRouterRef: z.string().optional(),
  }).passthrough().optional(),
  parentAgentId: z.string().optional(),
  traceId: z.string().optional(),
  orchestratorRef: z.object({
    platform: z.string().min(1),
    companyId: z.string().optional(),
    issueId: z.string().optional(),
    goalId: z.string().optional(),
  }).passthrough().optional(),
  pluginSource: z.enum(["public_marketplace", "corporate_marketplace", "corporate_private", "user_built"]).optional(),
  skillContext: z.object({
    activeSkills: z.array(z.string()).default([]),
    instructionFiles: z.array(z.string()).optional(),
    promptPolicyRefs: z.array(z.string()).optional(),
    promptSurface: z.string().optional(),
  }).passthrough().optional(),
  webhookSource: z.string().optional(),
  trustLevel: z.string().optional(),
  catalogProvider: z.string().optional(),
});

export type EvidenceIngestInput = z.infer<typeof EvidenceIngestSchema>;

export const EvaluateSchema = z.object({
  connector: z.string().min(1, "connector is required."),
  action: z.string().min(1, "action is required."),
  domains: z.array(z.string()).optional(),
  toolIntent: z.string().max(100000).optional().transform((val) => sanitizeText(val, 1000)),
  planSummary: z.string().max(100000).optional().transform((val) => sanitizeText(val, 2000)),
  toolParameters: z.record(z.string(), z.unknown()).optional().transform((val) => redactAndBoundParameters(val)),
});

export type EvaluateInput = z.infer<typeof EvaluateSchema>;

/**
 * Schema for PII erasure requests (POST /api/evidence/erase).
 *
 * Erasure is irreversible: a filter that is present but invalid must fail the
 * request instead of being dropped, which would silently widen the erasure
 * scope (e.g. a malformed `before` turning a bounded erasure into all of an
 * agent's history). `before` accepts only ISO-8601 shapes — lenient Date
 * parsing would reinterpret locale-ambiguous inputs like "03/02/2026" and
 * silently shift the erasure bound. An empty decisionIds array means the
 * filter is absent, not malformed.
 */
export const EvidenceEraseRequestSchema = z.object({
  decisionIds: z
    .array(z.string().trim().min(1, "decisionIds items must be non-empty strings."))
    .nullish()
    .transform((ids) => (ids?.length ? ids : undefined)),
  agentId: z
    .string()
    .trim()
    .min(1, "agentId must be a non-empty string.")
    .nullish()
    .transform((value) => value ?? undefined),
  before: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
      "before must be a valid ISO-8601 timestamp."
    )
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "before must be a valid ISO-8601 timestamp.")
    .transform((value) => new Date(value).toISOString())
    .nullish()
    .transform((value) => value ?? undefined),
});

export type EvidenceEraseRequest = z.infer<typeof EvidenceEraseRequestSchema>;
