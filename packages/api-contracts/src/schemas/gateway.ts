import { z } from "zod";
import { sanitizeText, redactAndBoundParameters } from "./sanitization";

const RuntimePolicyContextSchema = z.object({
  scope: z.enum(["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR"]),
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  artifactHash: z.string().min(1),
  packId: z.string().optional(),
  packVersion: z.string().optional(),
  packOwner: z.string().optional(),
});

/**
 * Schema for the gateway decision wire format (POST /api/gateway/decide).
 */
export const GatewayDecisionSchema = z.object({
  decisionId: z.string().min(1, "decisionId is required."),
  artifactHash: z.string().min(1, "artifactHash is required."),
  policyContext: z
    .array(RuntimePolicyContextSchema)
    .min(1, "policyContext must include at least one valid context node."),
  reason: z.string().optional(),
  // Risk context — all optional
  consequence: z.string().optional(),
  customerTier: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  amountUsd: z.number().nonnegative().optional(),
  dataSensitivity: z.string().optional(),
  trustScore: z.number().optional(),
  contextBudget: z.number().int().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  // Pre-flight intent fields (Phase 1)
  toolIntent: z
    .string()
    .max(100000)
    .optional()
    .transform((val) => sanitizeText(val, 1000)),
  planSummary: z
    .string()
    .max(100000)
    .optional()
    .transform((val) => sanitizeText(val, 2000)),
  toolParameters: z
    .record(z.string(), z.unknown())
    .optional()
    .transform((val) => redactAndBoundParameters(val)),
  connector: z.string().optional(),
  action: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().min(1).max(256).optional(),
});

export type GatewayDecisionInput = z.infer<typeof GatewayDecisionSchema>;

/**
 * Schema for gateway escalation queue resolution (POST /api/gateway/resolve).
 */
export const GatewayResolveSchema = z.object({
  queueId: z.string("queueId is required.").min(1, "queueId is required."),
  resolutionOutcome: z.enum(
    ["PROCEED", "ESCALATE", "ABORT"],
    "resolutionOutcome must be PROCEED, ESCALATE, or ABORT.",
  ),
  resolutionNote: z.string().optional(),
  agentGuidance: z.string().max(2000).optional(),
});

export type GatewayResolveInput = z.infer<typeof GatewayResolveSchema>;
