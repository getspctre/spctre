import { z } from "zod";

const JsonPathSchema = z
  .string()
  .regex(/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/, "Must use the supported JSONPath subset.");

export const EvidenceMappingValueSchema = z.union([
  JsonPathSchema,
  z.object({
    path: JsonPathSchema.optional(),
    default: z.unknown().optional(),
    transform: z.enum(["string", "number", "lowercase", "uppercase"]).optional(),
  }),
]);

export const EvidenceFieldMappingSchema = z
  .object({
    occurred_at: EvidenceMappingValueSchema,
    action: EvidenceMappingValueSchema,
    source_event_id: EvidenceMappingValueSchema.optional(),
    principal_id: EvidenceMappingValueSchema.optional(),
    agent_external_id: EvidenceMappingValueSchema.optional(),
    target_resource: EvidenceMappingValueSchema.optional(),
    policy_reference: EvidenceMappingValueSchema.optional(),
    environment: EvidenceMappingValueSchema.optional(),
    enforcement_decision: EvidenceMappingValueSchema.optional(),
  })
  .strict();

export type EvidenceFieldMapping = z.infer<typeof EvidenceFieldMappingSchema>;

export const CanonicalEnforcementDecisionSchema = z.enum(["allow", "deny", "escalate", "observe"]);
export type CanonicalEnforcementDecision = z.infer<typeof CanonicalEnforcementDecisionSchema>;
